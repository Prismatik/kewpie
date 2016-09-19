const amqp = require('amqplib');

const queueOpts = {
  maxPriority: 10,
  durable: true
};

let channel;
amqp.connect(process.env.RABBIT_URL).then(conn => {
  conn.createConfirmChannel().then(ch => {
    channel = ch;
  });
}).catch(e => {
  throw e;
});

function publish(queue, task, opts = {}) {
  if (!queue) return Promise.reject('Queue name is blank');
  if (!task) return Promise.reject('Task body is blank');

  if (!channel) return delay()
  .then(() => {
    return publish(queue, task, opts);
  });

  channel.assertQueue(queue, queueOpts);
  const innerOpts = {priority: opts.priority || 0, persistent: true};
  const buf = new Buffer(JSON.stringify(task));

  return new Promise((resolve, reject) => {
    channel.sendToQueue(queue, buf, innerOpts, function(err) {
      if (err) return reject(err);
      return resolve(task);
    });
  });
};

function subscribe(queue, handler) {
  return new Promise((resolve, reject) => {
    if (!channel) return delay()
    .then(() => {
      return subscribe(queue, handler);
    });

    channel.assertQueue(queue, queueOpts);
    channel.prefetch(process.env.MAX_CONCURRENT_JOBS || 1);

    channel.consume(queue, function(msg) {
      try {
        handler(JSON.parse(msg.content.toString()))
        .then(() => {
          channel.ack(msg);
        })
        .catch(() => {
          channel.nack(msg);
        });
      } catch (e) {
        channel.nack(msg);
      }
    });
  });
};

module.exports = {
  publish,
  subscribe
};

function delay() {
  return new Promise(resolve => {
    setTimeout(resolve, 500);
  });
};
