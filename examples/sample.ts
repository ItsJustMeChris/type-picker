type User = {
  id: string;
  name: string;
  email?: string;
};

async function loadUsers(): Promise<User[]> {
  return [
    { id: "1", name: "Ada" },
    { id: "2", name: "Grace", email: "grace@example.com" },
  ];
}

export async function listUserNames(): Promise<string[]> {
  const users = await loadUsers();
  return users.map((user) => user.name);
}

export const userCount = (await loadUsers()).length;

export const firstUser = (await loadUsers())[0];

export const userEmails = (await loadUsers()).map((user) => user.first);
