export type TransferPhase = 'unsaved' | 'preparing' | 'uploading' | 'saving' | 'saved' | 'failed' | 'draft';
export type TransferStatus = {
  phase: TransferPhase;
  title?: string;
  recordId?: string;
  message?: string;
  completed?: number;
  total?: number;
  photoCount?: number;
  at?: number;
};

/** A success receipt is emitted only after the server acknowledges the record. */
export async function transferRecord<T extends { photoIds: string[] }>(options: {
  record: T;
  files: File[];
  upload: (file: File) => Promise<string>;
  save: (record: T) => Promise<T>;
  onProgress: (status: TransferStatus) => void;
  onStaged: (record: T, uploaded: number) => void;
}): Promise<T> {
  let staged = { ...options.record, photoIds: [...options.record.photoIds] };
  const total = options.files.length + 1;
  for (let index = 0; index < options.files.length; index++) {
    options.onProgress({ phase: 'uploading', completed: index, total, message: `사진 ${index + 1}/${options.files.length}장 업로드 중` });
    const id = await options.upload(options.files[index]);
    staged = { ...staged, photoIds: [...staged.photoIds, id] };
    options.onStaged(staged, index + 1);
  }
  options.onProgress({ phase: 'saving', completed: options.files.length, total, message: '기록과 사진 연결을 서버에 저장하고 있습니다.' });
  const saved = await options.save(staged);
  options.onProgress({ phase: 'saved', completed: total, total, photoCount: saved.photoIds.length, at: Date.now() });
  return saved;
}

export async function withTimeout<T>(operation: Promise<T>, milliseconds = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('서버 응답 확인 시간 초과')), milliseconds); })]);
  } finally { if (timer) clearTimeout(timer); }
}

