FROM node:6

MAINTAINER Prismatik Pty. Ltd. <david@prismatik.com.au>

COPY ./package.json /app/

WORKDIR /app

RUN NODE_ENV=null npm install

ADD . /app

CMD ["npm", "test"]
