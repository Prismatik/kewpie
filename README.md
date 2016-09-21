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
