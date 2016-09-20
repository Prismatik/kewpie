const amqp = require('amqplib');
const uuid = require('uuid');

const defaultDeadLetterExchange = 'deadletters';
const defaultDeadLetterQueue = 'deadletters';


const queueOpts = {
  maxPriority: 10,
  durable: true,
  deadLetterExchange: defaultDeadLetterExchange,
  deadLetterRoutingKey: defaultDeadLetterQueue
};

let channel, connection;
let connectionAttempts = 0;
const defaultExpiration = 1000 * 60 * 60; // 1 hour

function connect(rabbitUrl) {
  return amqp.connect(rabbitUrl).then(conn => {
    connection = conn;
    conn.createConfirmChannel().then(ch => {
      ch.assertExchange(defaultDeadLetterExchange, 'direct', {durable: true})
      .then(() => {
        return ch.assertQueue(defaultDeadLetterQueue, {durable: true});
      }).then(() => {
        return ch.bindQueue(defaultDeadLetterQueue, defaultDeadLetterExchange, defaultDeadLetterQueue);
      }).then(() => {
        channel = ch;
      }).catch(e => {
        throw e;
      });
    });
  }).catch(e => {
    connectionAttempts++;
    if (connectionAttempts > 10) {
      throw e;
    } else {
      return delay()
      .then(() => connect(rabbitUrl));
    }
  });
};

function publish(queue, task, opts = {}) {
  if (!queue) return Promise.reject('Queue name is blank');
  if (!task) return Promise.reject('Task body is blank');

  if (!channel) return delay()
  .then(() => {
    return publish(queue, task, opts);
  });

  channel.assertQueue(queue, queueOpts);
  const innerOpts = {
    priority: opts.priority || 0,
    persistent: true,
    expiration: opts.expiration || defaultExpiration
  };

  if (opts.expiration === null) delete innerOpts.expiration;

  const buf = new Buffer(JSON.stringify(task));

  return new Promise((resolve, reject) => {
    channel.sendToQueue(queue, buf, innerOpts, function(err) {
      if (err) return reject(err);
      return resolve(task);
    });
  });
};

function unsubscribe(tag) {
  return channel.cancel(tag);
};

function subscribe(queue, handler) {
  if (!channel) return delay()
  .then(() => {
    return subscribe(queue, handler);
  });

  const consumerTag = uuid.v4();

  return new Promise((resolve, reject) => {

    channel.assertQueue(queue, queueOpts)
    .then(() => {
      channel.prefetch(process.env.MAX_CONCURRENT_JOBS || 1);

      channel.consume(queue, function(msg) {
        try {
          handler(JSON.parse(msg.content.toString()))
          .then(() => {
            channel.ack(msg);
          })
          .catch(({requeue = false}) => {
            channel.nack(msg, false, requeue);
          });
        } catch (e) {
          // The only time this should be reached is when JSON.parse fails, so never requeue this kind of failure
          channel.nack(msg, false, false);
        }
      }, {consumerTag});

      return resolve({consumerTag});
    });
  });
};

function close() {
  return connection.close();
};

module.exports = {
  publish,
  subscribe,
  unsubscribe,
  connect,
  close
};

function delay() {
  return new Promise(resolve => {
    setTimeout(resolve, 500);
  });
};
