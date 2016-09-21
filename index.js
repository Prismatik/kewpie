const amqp = require('amqplib');
const uuid = require('uuid');

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

const blankQueueError = new Error('Queue name is blank');
const blankTaskError = new Error('Task body is blank');

/**
 * Return an instance of Kewpie
 * @constructor
 * @module Kewpie
 * @param {kewpieOpts} [passedOpts] - A set of options to override the defaults
 * @returns {Kewpie}
 */
function Kewpie(passedOpts = {}) {
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

  let channel;
  let connection;
  let connectionAttempts = 0;

  /**
   * Connect to the RabbitMQ server and set up the queues and exchanges
   * @module Kewpie/connect
   * @param {string} rabbitUrl - The URL to connect to a rabbitMQ server, eg: amqp://localhost:15672
   * @param {string[]} queues - The queues to instantiate for later publishing or subscription
   * @returns {Promise}
   */
  function connect(rabbitUrl, queues) {
    return amqp.connect(rabbitUrl)
    .then(conn => {
      connection = conn;

      return conn.createConfirmChannel()
      .then(ch =>
        setup(ch, queues)
        .then(() => {
          channel = ch;
        })
      );
    })
    .catch(reconnect(rabbitUrl, queues));
  }

  /**
   * Set up the queues and exchanges
   * @param {Object} ch - A channel returned from amqplib
   * @param {string[]} queues - The queues to instantiate for later publishing or subscription
   * @returns {Promise}
   */
  function setup(ch, queues) {
    return ch.assertExchange(exchange, 'topic', { durable: true })
    .then(queues.map(queue =>
      ch.assertQueue(queue, queueOpts)
      .then(ch.bindQueue(queue, exchange, queue))
    ))
    .then(() => {
      ch.assertExchange(deadLetterExchange, 'topic', { durable: true })
      .then(() =>
        ch.assertQueue(deadLetterQueue, { durable: true })
      ).then(() =>
        ch.bindQueue(deadLetterQueue, deadLetterExchange, '#')
      ).catch(e => {
        throw e;
      });
    });
  }

  /**
   * If the connection to RabbitMQ fails, wait a little bit then try again
   * @param {string} rabbitUrl - The URL to connect to a rabbitMQ server, eg: amqp://localhost:15672
   * @param {string[]} queues - The queues to instantiate for later publishing or subscription
   * @returns {Promise}
   */
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
  }

  /**
   * Publish a message/task to a queue
   * @module Kewpie/publish
   * @param {string} queue - The name of the queue you intend the message to reach. This will be used as the message's routing key
   * @param {Object} task - Any `JSON.stringify`able Object. This will be serialised and sent as the message body
   * @param {Object} [opts] - A set of opts to override defaults
   * @param {number} opts.priority - The priority of the message (defaults to 0)
   * @param {number} opts.expiration - The expiration time of the message in MS
   * @returns {Promise}
   */
  function publish(queue, task, opts = {}) {
    if (!queue) return Promise.reject(blankQueueError);
    if (!task) return Promise.reject(blankTaskError);

    if (!channel) {
      return delay(delayMS)
      .then(() =>
        publish(queue, task, opts)
      );
    }

    const innerOpts = {
      priority: opts.priority || 0,
      persistent: true,
      expiration: opts.expiration || defaultExpiration
    };

    if (opts.expiration === null) delete innerOpts.expiration;

    const buf = new Buffer(JSON.stringify(task));

    return new Promise((resolve, reject) => {
      channel.publish(exchange, queue, buf, innerOpts, (err) => {
        if (err) return reject(err);
        return resolve(task);
      });
    });
  }

  /**
   * Unsubscribe a subscriber/handler from a queue
   * @module Kewpie/unsubscribe
   * @param {string} tag - The consumerTag of the subscriber
   * @returns {Promise}
   */
  function unsubscribe(tag) {
    return channel.cancel(tag);
  }

  /**
   * Subscribe a handler to a queue
   * @module Kewpie/subscribe
   * @param {string} queue - The queue you wish to subscribe to
   * @param {function} handler - The queue you wish to subscribe to
   * @returns {Consumer}
   */
  function subscribe(queue, handler) {
    if (!channel) {
      return delay(delayMS)
      .then(() =>
        subscribe(queue, handler)
      );
    }

    const consumerTag = uuid.v4();

    return new Promise(resolve => {
      channel.assertQueue(queue, queueOpts)
      .then(() => {
        channel.prefetch(process.env.MAX_CONCURRENT_JOBS || 1);

        channel.consume(queue, (msg) => {
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
        }, { consumerTag });

        return resolve({ consumerTag });
      });
    });
  }

  /**
   * Close the connection to RabbitMQ
   * @module Kewpie/close
   * @returns {Promise}
   */
  function close() {
    return connection.close();
  }

  return {
    publish,
    subscribe,
    unsubscribe,
    connect,
    close,
    errors: {
      blankQueueError,
      blankTaskError
    },
    opts
  };
}

module.exports = Kewpie;
