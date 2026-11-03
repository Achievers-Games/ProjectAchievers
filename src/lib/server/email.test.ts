import { describe, expect, it, vi } from 'vitest';

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({ sendMail: sendMailMock, verify: vi.fn() }),
  },
}));

vi.mock('./env', () => ({
  env: () => ({
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 587,
    SMTP_USER: 'contact@achievers.games',
    SMTP_PASS: 'secret',
    SMTP_FROM: 'contact@achievers.games',
    SMTP_FROM_NAME: 'Project Achievers',
  }),
}));

describe('sendMail', () => {
  it("utilise l'expéditeur configuré et transmet replyTo", async () => {
    const { sendMail } = await import('./email');
    sendMailMock.mockResolvedValueOnce({ accepted: ['contact@achievers.games'] });

    await sendMail({
      to: 'contact@achievers.games',
      replyTo: 'visiteur@example.com',
      subject: '[Contact] Test',
      text: 'Bonjour',
    });

    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'Project Achievers <contact@achievers.games>',
      to: 'contact@achievers.games',
      subject: '[Contact] Test',
      text: 'Bonjour',
      html: undefined,
      replyTo: 'visiteur@example.com',
    });
  });
});
