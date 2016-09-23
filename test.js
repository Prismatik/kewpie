const demand = require('must/register');
require('co-mocha');
const Kewpie = require('./index');
const bandname = require('bandname');
const amqp = require('amqplib');

const kewpie = new Kewpie();

describe('kewpie', () => {
  const queueName = bandname();
  let tag;
  let directTag;
  let channel;

  before(function () {
    this.timeout(5000);
    return kewpie.connect(process.env.RABBIT_URL, [queueName]);
  });

  afterEach(function *() {
    const conn = yield amqp.connect(process.env.RABBIT_URL);
    const ch = yield conn.createChannel();
    yield ch.purgeQueue(queueName);
    yield ch.purgeQueue(kewpie.opts.deadLetterQueue);
    if (tag) yield kewpie.unsubscribe(tag);
    if (directTag) yield channel.cancel(directTag);
    tag, directTag = undefined;
  });

  describe('publish', () => {
    it('should queue a task', () =>
      kewpie.publish(queueName, {
        oh: 'hai'
      })
    );

    it('should complain about a falsy task', () =>
      kewpie.publish(queueName, '').must.reject.to.equal(kewpie.errors.blankTaskError)
    );

    it('should complain about a falsy queue name', () =>
      kewpie.publish('', 'hi').must.reject.to.equal(kewpie.errors.blankQueueError)
    );

    it('should publish a message with no expiration', function *() {
      yield kewpie.publish(queueName, {
        oh: 'hai'
      }, {
        expiration: null
      })

      const conn = yield amqp.connect(process.env.RABBIT_URL);
      channel = yield conn.createConfirmChannel();
      const { consumerTag } = yield channel.consume(queueName, function (msg) {
        demand(msg.properties.expiration).be(undefined);
      });
      directTag = consumerTag;
    });

    it('should gracefully handle invalid json', function *() {
      let thrown = false;

      const object = {};
      object.arr = [
        object, object
      ];
      object.arr.push(object.arr);
      object.obj = object;

      try {
        yield kewpie.publish(queueName, object);
      } catch (e) {
        e.must.equal(kewpie.errors.invalidJsonError);
        thrown = true;
      }
      thrown.must.be(true)
    });
  });
  describe('subscribe', () => {
    let taskName;

    beforeEach(function *() {
      taskName = bandname();

      const conn = yield amqp.connect(process.env.RABBIT_URL);
      channel = yield conn.createConfirmChannel();
    });

    it('should be handed a job', (done) => {
      kewpie.subscribe(queueName, task => {
        task.name.must.equal(taskName);
        done();
        return Promise.resolve();
      })
      .then(({ consumerTag }) => {
        tag = consumerTag;
      });
      kewpie.publish(queueName, { name: taskName });
    });

    it('should requeue a failed job', (done) => {
      let times = 0;
      kewpie.subscribe(queueName, task => {
        task.name.must.equal(taskName);
        if (times > 3) {
          done();
          return Promise.resolve();
        }
        times++;
        return Promise.reject({ requeue: true });
      })
      .then(({ consumerTag }) => {
        tag = consumerTag;
      });
      kewpie.publish(queueName, { name: taskName });
    });

    it('should never pass a job with invalid JSON to the handler', (done) => {
      kewpie.subscribe(queueName, () => {
        done(new Error('job was passed to subscribe handler'));
      }).then(({ consumerTag }) => {
        tag = consumerTag;
      });

      amqp.connect(process.env.RABBIT_URL, [queueName])
      .then(conn => {
        conn.createConfirmChannel().then(ch => {
          ch.sendToQueue(queueName, new Buffer('lol not json'), {}, err => {
            if (err) return done(err);
            return setTimeout(done, 500);
          });
        });
      });
    });

    it('should never requeue a job with invalid json', (done) => {
      kewpie.subscribe(queueName, () => {
        done(new Error('subscribe handler should never be called in this test'));
      }).then(({ consumerTag }) => {
        tag = consumerTag;
      });

      channel.sendToQueue(queueName, new Buffer('lol not json'), {}, err => {
        if (err) return done(err);
        return null;
      });

      setTimeout(() => {
        channel.checkQueue(queueName).then(queue => {
          queue.messageCount.must.equal(0);
          done();
        });
      }, 500);
    });

    it('should send failed jobs to the dead letter queue by default', (done) => {
      kewpie.subscribe(queueName, () =>
        Promise.reject()
      ).then(({ consumerTag }) => {
        tag = consumerTag;
      });

      setTimeout(() => {
        channel.checkQueue(kewpie.opts.deadLetterQueue).then(queue => {
          queue.messageCount.must.equal(1);
          done();
        })
        .catch(done);
      }, 500);

      kewpie.publish(queueName, { oh: 'hai' });
    });

    it('should optionally requeue failed messages', (done) => {
      let times = 0;
      kewpie.subscribe(queueName, () => {
        if (times === 1) return done();
        times++;
        return Promise.reject({ requeue: true });
      }).then(({ consumerTag }) => {
        tag = consumerTag;
      });

      kewpie.publish(queueName, { oh: 'hai' });
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe the handler', (done) => {
      let times = 0;
      let tag;
      kewpie.subscribe(queueName, () => {
        times++;
        return Promise.resolve();
      })
      .then(({ consumerTag }) => {
        tag = consumerTag;
      });

      kewpie.publish(queueName, { number: 1 })
      .then(() =>
        new Promise(resolve =>
          setTimeout(resolve, 10)
        )
      )
      .then(() => kewpie.unsubscribe(tag))
      .then(() => kewpie.publish(queueName, { number: 2 }))
      .then(() => {
        setTimeout(() => {
          times.must.equal(1);
          done();
        }, 500);
      });
    });
  });
});
