/** Le nom d'un succès sans casse ni ponctuation, comme pour reconnaître les familles. */
export const sameName = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
