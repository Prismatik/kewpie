const amqp = require('amqplib');
const uuid = require('uuid');

function kewpie(passedOpts = {}) {
  const defaultOpts = {
    deadLetterExchange: 'deadletters',
    deadLetterQueue: 'deadletters',
    exchange: 'kewpie',
    maxPriority: 10,
    defaultExpiration: 1000 * 60 * 60, // 1 hour
    maxConnectionAttempts: 10,
    delayMS: 500
  };

  const opts = Object.assign({}, passedOpts, defaultOpts);

  const {
    delayMS,
    maxConnectionAttempts,
    defaultExpiration,
    maxPriority,
    deadLetterExchange,
    deadLetterQueue,
    exchange
  } = opts;

  const queueOpts = {
    maxPriority,
    durable: true,
    deadLetterExchange
  };

  let channel, connection;
  let connectionAttempts = 0;

  function connect(rabbitUrl, queues) {
    return amqp.connect(rabbitUrl)
    .then(conn => {
      connection = conn;

      return conn.createConfirmChannel()
      .then(ch => {
        return setup(ch, queues)
        .then(() => channel = ch);
      })
    })
    .catch(reconnect(rabbitUrl, queues));
  };

  function setup(ch, queues) {
    return ch.assertExchange(exchange, 'topic', {durable: true})
    .then(queues.map(queue => {
      return ch.assertQueue(queue, queueOpts)
      .then(ch.bindQueue(queue, exchange, queue));
    }))
    .then(() => {
      ch.assertExchange(deadLetterExchange, 'topic', {durable: true})
      .then(() => {
        return ch.assertQueue(deadLetterQueue, {durable: true});
      }).then(() => {
        return ch.bindQueue(deadLetterQueue, deadLetterExchange, '#');
      }).catch(e => {
        throw e;
      });
    });
  };

  function reconnect(rabbitUrl, queues) {
    return e => {
      connectionAttempts++;
      if (connectionAttempts > maxConnectionAttempts) {
        throw e;
      } else {
        return delay(delayMS)
        .then(() => connect(rabbitUrl, queues));
      }
    };
  };

  function publish(queue, task, opts = {}) {
    if (!queue) return Promise.reject(blankQueueError);
    if (!task) return Promise.reject(blankTaskError);

    if (!channel) return delay(delayMS)
    .then(() => {
      return publish(queue, task, opts);
    });

    const innerOpts = {
      priority: opts.priority || 0,
      persistent: true,
      expiration: opts.expiration || defaultExpiration
    };

    if (opts.expiration === null) delete innerOpts.expiration;

    const buf = new Buffer(JSON.stringify(task));

    return new Promise((resolve, reject) => {
      channel.publish(exchange, queue, buf, innerOpts, function(err) {
        if (err) return reject(err);
        return resolve(task);
      });
    });
  };

  function unsubscribe(tag) {
    return channel.cancel(tag);
  };

  function subscribe(queue, handler) {
    if (!channel) return delay(delayMS)
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
            .catch((opts = {}) => {
              opts.requeue = opts.requeue || false;
              channel.nack(msg, false, opts.requeue);
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

  return {
    publish,
    subscribe,
    unsubscribe,
    connect,
    close,
    blankQueueError,
    blankTaskError
  };
};

module.exports = kewpie;

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
};

const blankQueueError = new Error('Queue name is blank');
const blankTaskError = new Error('Task body is blank');
