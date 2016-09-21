require('must/register');
const Kewpie = require('./index');
const bandname = require('bandname');
const amqp = require('amqplib');

const kewpie = new Kewpie();

describe('kewpie', () => {
  const queueName = bandname();

  before(function() {
    this.timeout(5000);
    return kewpie.connect(process.env.RABBIT_URL, [queueName]);
  });

  afterEach(() => {
    return amqp.connect(process.env.RABBIT_URL)
    .then(conn => {
      return conn.createChannel().then(ch => {
        return ch.purgeQueue(queueName)
        .then(() => ch.purgeQueue('deadletters'));
      });
    });
  });

  describe('publish', () => {
    it('should queue a task', () => {
      return kewpie.publish(queueName, {
        oh: 'hai'
      });
    });

    it('should complain about a falsy task', () => {
      return kewpie.publish(queueName, '').must.reject.to.equal(kewpie.blankTaskError);
    });

    it('should complain about a falsy queue name', () => {
      return kewpie.publish('', 'hi').must.reject.to.equal(kewpie.blankQueueError);
    });
  });
  describe('subscribe', () => {
    let taskName, tag, channel;

    beforeEach(() => {
      taskName = bandname();

      return amqp.connect(process.env.RABBIT_URL)
      .then(conn => {
        conn.createConfirmChannel().then(ch => channel = ch);
      });
    });

    afterEach(() => {
      return kewpie.unsubscribe(tag);
    });

    it('should be handed a job', (done) => {
      kewpie.subscribe(queueName, task => {
        task.name.must.equal(taskName);
        done();
        return Promise.resolve();
      })
      .then(({consumerTag}) => {
        tag = consumerTag;
      });
      kewpie.publish(queueName, {name: taskName});
    });

    it('should requeue a failed job', (done) => {
      let times = 0;
      kewpie.subscribe(queueName, task => {
        task.name.must.equal(taskName);
        if (times > 3) {
          done();
          return Promise.resolve();
        } else {
          times++;
          return Promise.reject({requeue: true});
        }
      })
      .then(({consumerTag}) => {
        tag = consumerTag;
      });
      kewpie.publish(queueName, {name: taskName});
    });

    it('should never pass a job with invalid JSON to the handler', (done) => {
      kewpie.subscribe(queueName, task => {
        done(new Error('job was passed to subscribe handler'));
      }).then(({consumerTag}) => {
        tag = consumerTag;
      });

      amqp.connect(process.env.RABBIT_URL, [queueName])
      .then(conn => {
        conn.createConfirmChannel().then(ch => {
          ch.sendToQueue(queueName, new Buffer('lol not json'), {}, err => {
            if (err) return done(err);
            setTimeout(done, 500);
          });
        });
      });
    });

    it('should never requeue a job with invalid json', (done) => {
      kewpie.subscribe(queueName, task => {
        done(new Error('subscribe handler should never be called in this test'));
      }).then(({consumerTag}) => {
        tag = consumerTag;
      });

      channel.sendToQueue(queueName, new Buffer('lol not json'), {}, err => {
        if (err) return done(err);
      });

      setTimeout(() => {
        channel.checkQueue(queueName).then(queue => {
          queue.messageCount.must.equal(0);
          done();
        });
      }, 500);
    });

    it('should send failed jobs to the dead letter queue by default', (done) => {
      kewpie.subscribe(queueName, task => {
        return Promise.reject();
      }).then(({consumerTag}) => {
        tag = consumerTag;
      });

      setTimeout(() => {
        channel.checkQueue('deadletters').then(queue => {
          queue.messageCount.must.equal(1);
          done();
        })
        .catch(done);
      }, 500);

      kewpie.publish(queueName, { oh: 'hai' });
    });

    it('should optionally requeue failed messages', (done) => {
      let times = 0;
      kewpie.subscribe(queueName, task => {
        if (times === 1) return done();
        times++;
        return Promise.reject({requeue: true});
      }).then(({consumerTag}) => {
        tag = consumerTag;
      });

      kewpie.publish(queueName, { oh: 'hai' });
    });
  });
});
