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
        return ch.purgeQueue(queueName);
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
    let taskName, tag;

    beforeEach(() => {
      taskName = bandname();
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
        return Promise.reject();
      });

      amqp.connect(process.env.RABBIT_URL, [queueName])
      .then(conn => {
        conn.createConfirmChannel().then(ch => {
          ch.consume(queueName, msg => {
            done(new Error('job was passed to consume function'));
          });

          ch.sendToQueue(queueName, new Buffer('lol not json'), {}, err => {
            if (err) return done(err);
          });

          setTimeout(done, 500);
        });
      });
    });
  });
});
