require('must/register');
const kewpie = require('./index');
const bandname = require('bandname');

describe('kewpie', () => {
    let queueName;

    beforeEach(() => {
      queueName = bandname();
    });
  describe('create', () => {
    it('should queue a task', () => {
      return kewpie.create(queueName, {
        oh: 'hai'
      });
    });

    it('should complain about a falsy task', () => {
      return kewpie.create(queueName, '').must.reject.to.equal('Task body is blank');
    });

    it('should complain about a falsy queue name', () => {
      return kewpie.create('', 'hi').must.reject.to.equal('Queue name is blank');
    });
  });
  describe('subscribe', () => {
    let taskName;

    beforeEach(() => {
      taskName = bandname();
    });

    it('should be handed a job', (done) => {
      kewpie.subscribe(queueName, task => {
        task.name.must.equal(taskName);
        done();
        return Promise.resolve();
      })
      kewpie.create(queueName, {name: taskName});
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
      kewpie.create(queueName, {name: taskName});
    });
  });
});
