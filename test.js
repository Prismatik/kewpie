require('must/register');
const kewpie = require('./index');
const bandname = require('bandname');
const amqp = require('amqplib');

describe('kewpie', function() {
  this.timeout(5000);
  const queueName = bandname();

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
      return kewpie.publish(queueName, '').must.reject.to.equal('Task body is blank');
    });

    it('should complain about a falsy queue name', () => {
      return kewpie.publish('', 'hi').must.reject.to.equal('Queue name is blank');
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
          return Promise.reject();
        }
      })
      .then(({consumerTag}) => {
        tag = consumerTag;
      });
      kewpie.publish(queueName, {name: taskName});
    });
  });
});
