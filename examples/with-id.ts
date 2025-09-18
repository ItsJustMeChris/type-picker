interface MigrationLock {
  owner?: string;
  status: 'running' | 'idle';
  expiresAt?: Date;
}

type WithId<T> = T & { _id: string };

export function example(lockDoc: WithId<MigrationLock> | null) {
  if (!lockDoc) return 'nope';
  return lockDoc.status;
}
