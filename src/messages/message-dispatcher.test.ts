import { MessageDispatcher } from './message-dispatcher.js';

describe('MessageDispatcher', () => {
  it('delivers messages to a known recipient', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(1000));
    const deliverMessageFn = jest.fn();
    const dispatcher = new MessageDispatcher({
      recipients: {
        alice: {
          deliverMessage: deliverMessageFn,
        },
      },
    });
    dispatcher.sendMessage({
      fromId: 'bob',
      toId: 'alice',
      content: 'hi there',
    });
    expect(deliverMessageFn).toHaveBeenCalledTimes(1);
    expect(deliverMessageFn).toHaveBeenCalledWith({
      fromId: 'bob',
      content: 'hi there',
      sentAt: new Date(1000),
    });
  });

  it('does not deliver to an unknown recipient', () => {
    const deliverMessageFn = jest.fn();
    const dispatcher = new MessageDispatcher({
      recipients: {
        alice: {
          deliverMessage: deliverMessageFn,
        },
      },
    });
    dispatcher.sendMessage({
      fromId: 'bob',
      toId: 'not-alice',
      content: 'hi there',
    });
    expect(deliverMessageFn).not.toHaveBeenCalled();
  });
});
