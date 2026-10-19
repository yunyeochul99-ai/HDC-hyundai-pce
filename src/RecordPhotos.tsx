import { useEffect, useRef, useState } from 'react';
import { Photo } from './AuthGate';
import { preparePhoto, photoSize } from './photo-compression';
import './record-photos.css';

type Props = {
  photoIds: string[];
  files: File[];
  disabled: boolean;
  onPhotosChange: (ids: string[]) => void;
  onFilesChange: (files: File[]) => void;
  onError: (message: string) => void;
  onPreparingChange: (preparing: boolean) => void;
};

function SelectedPhoto({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img src={url} alt={`추가할 사진: ${file.name}`} /> : null;
}

export default function RecordPhotos({ photoIds, files, disabled, onPhotosChange, onFilesChange, onError, onPreparingChange }: Props) {
  const active = useRef(true);
  const preparingLock = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [compressionNote, setCompressionNote] = useState('');
  useEffect(() => { active.current = true; return () => { active.current = false; onPreparingChange(false); }; }, [onPreparingChange]);
  const locked = disabled || preparing;
  const [knownIds, setKnownIds] = useState(() => [...photoIds]);
  useEffect(() => {
    setKnownIds(before => photoIds.some(id => !before.includes(id)) ? Array.from(new Set([...before, ...photoIds])) : before);
  }, [photoIds]);
  const savedIds = Array.from(new Set([...knownIds, ...photoIds]));
  const count = photoIds.length + files.length;
  const removedCount = savedIds.filter(id => !photoIds.includes(id)).length;
  async function selectFiles(selected: File[]) {
    if (!selected.length || preparingLock.current) return;
    preparingLock.current = true;
    setPreparing(true); onPreparingChange(true); onError(''); setCompressionNote('');
    try {
    const prepared: File[] = [];
    const notes: string[] = [];
    for (const original of selected) {
      const photo = await preparePhoto(original);
      if (!active.current) return;
      prepared.push(photo);
      if (photo !== original) notes.push(`${original.name}: ${photoSize(original.size)} → ${photoSize(photo.size)}`);
    }
    const next = [...files];
    for (const file of prepared) {
      if (!next.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) next.push(file);
    }
    if (photoIds.length + next.length > 5) {
      onError('사진은 기존 사진과 추가할 사진을 합해 총 5장까지 저장할 수 있습니다. 먼저 사진을 삭제해 주세요.');
      return;
    }
    onFilesChange(next);
    onError('');
    setCompressionNote(notes.length ? `자동 압축 완료 · ${notes.join(' / ')}` : '');
    } catch (failure) {
      if (active.current) onError(`${failure instanceof Error ? failure.message : '사진을 준비하지 못했습니다.'} 기존 선택은 유지됩니다.`);
    } finally {
      preparingLock.current = false;
      if (active.current) { setPreparing(false); onPreparingChange(false); }
    }
  }
  function toggleSaved(id: string) {
    if (photoIds.includes(id)) onPhotosChange(photoIds.filter(value => value !== id));
    else {
      if (count >= 5) { onError('복원하려면 추가할 사진을 취소해 총 5장 이하로 맞춰 주세요.'); return; }
      onPhotosChange(savedIds.filter(value => value === id || photoIds.includes(value)));
    }
    onError('');
  }
  return <section className="record-photos" aria-labelledby="record-photos-title">
    <div className="record-photos-heading"><h3 id="record-photos-title">현장 사진</h3><span role="status">{preparing ? '사진 확인·자동 압축 중…' : `저장할 사진 ${count}/5장${removedCount > 0 ? ` · 삭제 예정 ${removedCount}장` : ''}`}</span></div>
    <p className="record-photos-help">사진 추가·삭제는 ‘서버에 저장’을 눌러야 반영됩니다. 취소하면 기존 사진은 유지됩니다. 다른 기록에 첨부된 사진은 그대로 보존됩니다.</p>
    {savedIds.length > 0 && <div className="record-photos-grid">{savedIds.map((id, index) => {
      const removed = !photoIds.includes(id);
      return <div key={id} className={`record-photo-card${removed ? ' is-removed' : ''}`}>
        <div className="record-photo-image"><Photo id={id} alt={`기존 사진 ${index + 1}`} /></div>
        <div className="record-photo-caption"><span>{removed ? '삭제 예정' : `기존 사진 ${index + 1}`}</span><button type="button" disabled={locked} onClick={() => toggleSaved(id)} aria-label={`기존 사진 ${index + 1} ${removed ? '삭제 취소' : '삭제'}`}>{removed ? '삭제 취소' : '삭제'}</button></div>
      </div>;
    })}</div>}
    {files.length > 0 && <div className="record-photos-grid">{files.map((file, index) => <div className="record-photo-card" key={`${file.name}-${file.size}-${file.lastModified}`}>
      <div className="record-photo-image"><SelectedPhoto file={file} /></div>
      <div className="record-photo-caption"><span title={file.name}>추가 예정 · {file.name}<small>{photoSize(file.size)}</small></span><button type="button" disabled={locked} onClick={() => { onFilesChange(files.filter((_, position) => position !== index)); onError(''); }} aria-label={`추가할 사진 ${index + 1} 취소`}>추가 취소</button></div>
    </div>)}</div>}
    {savedIds.length === 0 && files.length === 0 && <p className="record-photos-empty">첨부된 사진이 없습니다. 아래에서 사진을 추가하세요.</p>}
    {compressionNote && <p className="record-photos-help" role="status">{compressionNote}</p>}
    <label className="record-photo-picker">사진 추가 <small>JPG · PNG · WebP / 5MB 초과 사진은 자동 압축 / 총 5장</small><input aria-label="현장 사진 추가" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={locked || count >= 5} onChange={event => { void selectFiles(Array.from(event.target.files || [])); event.target.value = ''; }} /></label>
  </section>;
}


