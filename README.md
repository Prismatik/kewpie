# Kewpie
Kewpie is a set of reasonable, safe defaults to use RabbitMQ as a task queue. It's intended to give you a robust, fairly future proof setup without you needing to understand all the nuances of exchange routing and dead letter behaviour.

### It's as easy as
`npm install kewpie`

```javascript
const Kewpie = require('kewpie');
const kewpie = new Kewpie();

const queueName = 'foo';

kewpie.connect('amqp://localhost:15672', [queueName]);
kewpie.publish(queueName, {bar: 'Hello world!'})
kewpie.subscribe(queueName, task => {
  console.log(task.bar);
  setTimeout(kewpie.close, 100);
  return Promise.resolve();
});
```

### Tell me more!
```javascript
kewpie.publish('foo', {oh: 'hi'})
.then(() => console.log('yay!')
.catch((e) => console.error('oh dear')
// Kewpie always uses confirmQueues so that it can confirm a message has definitely been written to the server.
// It exposes a sane, consistent promises interface.

kewpie.subscribe('foo', task => {
  return Promise.resolve(); // This message will be acked and will be removed from the queue.
});

kewpie.subscribe('foo', task => {
  return Promise.reject(); // This message will be removed from the queue and placed on the dead letter queue. It won't be retried, but it will be there for you to inspect and figure out what went wrong later.
});

kewpie.subscribe('foo', task => {
  return Promise.reject({requeue: true}); // This message will be nacked and put back on the queue to be retried ASAP.
});

kewpie.subscribe('foo', () => {})
.then(({consumerTag}) => kewpie.unsubscribe(consumerTag));
// kewpie.subscribe returns a tag that will let you later deregister that consumer
```

### Under the hood
Kewpie takes care of:
* Provisioning a durable topic exchange
* Provisioning all queues (durable, of course)
* Provisioning a dead letter exchange and queues
* Setting up all bindings
* Serialising and deserialising messages
* Automatically dead lettering unserialisable messages
* Setting a default expiry for all messages


Kewpie gives you a flexible and extensible router and queue setup. If your needs evolve, you can provision additional queues that listen to patterns on your exchange with ease.


If your needs evolve beyond Kewpie's defaults, it should take you no more than an hour to replicate the Kewpie setup in your own code using amqplib. It's under 200LOC excluding JSDoc comments.

### API documentation
[JSDoc](https://prismatik.github.io/kewpie/api_jsdoc/)

### Gory details
Want to know how the underlying RabbitMQ bits are provisioned? Here it is.

Note that you don't _need_ to understand all of this in order to use Kewpie. The point of this tool is to allow you to get up and running quickly, then skill up on RabbitMQ as you go. Starting with Kewpie means that once you _do_ understand all this, you'll have it already in place rather than having to figure out how to migrate from a more simplistic setup to something more flexible.

```
                                                 +---------------------+     +------------+
                                                 |Queue 1              |     |Consumer    |
                                                 |(acked)              |     |            |
                                                 +---------------------+     +------------+
+------------+
|Publisher   |     +---------+-------------+     +---------------------+     +------------+     +---------+-------------+     +------+--------------+
|            |     |Exchange - Kewpie      |     |Queue 2              |     |Consumer    |     |Exchange - deadletters |     |Queue - deadletters  |
|            |     |(topic mode)           |     |(acked)              |     |            |     |(topic mode)           |     |                     |
|            |     +-----------------------+     +---------------------+     +------------+     +-----------------------+     +---------------------+
+------------+
                                                 +---------------------+     +------------+
                                                 |Queue n...           |     |Consumer    |
                                                 |(acked)              |     |            |
                                                 +---------------------+     +------------+
```

So, ordinarily:

1. A publisher sends a message to the main exchange.
1. It gets routed to the queue named in the routing key.
1. A consumer picks it up.
1. The message is either marked as complete (acked) or it fails and is sent to the dead letter exchange.
1. The dead letter exchange routes it to the deadletters queue, along with some metadata showing the queue it originally came from.

Simples!

There are a few touches that make this setup flexible into the future.

* All messages route through an [exchange](https://www.rabbitmq.com/tutorials/tutorial-three-javascript.html) rather than going direct to queues. If you want to CC all messages for the queue named "todos" to the queue named "audit log", just create the new queue and set up the binding. No code to change.
* All exchanges are set up as [topic exchanges](https://www.rabbitmq.com/tutorials/tutorial-five-javascript.html). If you are creating queues programatically and want to CC some subset of them according to a namespace, that's easy. Just create the binding with a wildcard.
* If you want to send failures from specific queues to other specific dead letter queues for further processing, no problems, just create queues and add bindings to dead letter.

There are a few touches that make this setup safe:

* All queues have a [dead letter](https://www.rabbitmq.com/dlx.html) setup, ensuring that nothing gets dropped silently.
* All messages have a default per-message [TTL](https://www.rabbitmq.com/ttl.html) set in code, giving you some protection against a faulty message being retried endlessly and DOSing your workers. We _don't_, however, set a default TTL on the queue. This gives you the ability to change your default TTL in code without needing to synchronise the change across every single publisher simultaneously.
