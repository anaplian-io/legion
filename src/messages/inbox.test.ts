import { Inbox } from './inbox.js';

describe('Inbox', () => {
  it('sends and receives messages', () => {
    const inbox = new Inbox();
    inbox
      .deliverMessage({
        fromId: 'someone-else',
        content: 'this is a message',
        sentAt: new Date(1000),
      })
      .deliverMessage({
        fromId: 'another-someone-else',
        content: 'some other message',
        sentAt: new Date(2000),
      });
    expect(inbox.receiveMessages()).toStrictEqual([
      {
        fromId: 'someone-else',
        content: 'this is a message',
        sentAt: new Date(1000),
      },
      {
        fromId: 'another-someone-else',
        content: 'some other message',
        sentAt: new Date(2000),
      },
    ]);
  });
});
