/** Options communes : un cookie du site n'est lisible que par le serveur, sauf exception. */
export const secureCookie = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
} as const;
