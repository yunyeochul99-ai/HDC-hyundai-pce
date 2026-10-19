import {useEffect,useState,type ComponentProps} from 'react';
import Workspace from './Workspace';
import BrandLogo from './BrandLogo';
import {Photo} from './AuthGate';
import {supabase} from './backend';
import {photoStageLabels,type PhotoDetail} from './photo-details';
type Receipt={photoId:string;title:string;equipmentName:string;details:PhotoDetail};
function ExportPhotoViewer({record,photo,onSignOut}:{record:string;photo:string;onSignOut:()=>void}){
 const [receipt,setReceipt]=useState<Receipt|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setReceipt(null);setError('');supabase.rpc('hdc_v2_export_photo',{p_record:record,p_photo:photo}).then(({data,error})=>{if(!active)return;if(error)setError(error.message||'사진 접근 권한을 확인할 수 없습니다.');else setReceipt(data as Receipt);});return()=>{active=false;};},[record,photo]);
 return <main className="auth-screen"><section className="auth-card csv-photo-viewer"><BrandLogo/><h1>운영 CSV 사진 보기</h1><p>지정된 본인 관리자 계정의 로그인과 사진 접근 권한을 확인합니다.</p>{error?<p className="auth-error" role="alert">{error}</p>:receipt?<><h2>{receipt.title}</h2><p>{receipt.equipmentName} · {photoStageLabels[receipt.details.stage]||'미분류'}</p><Photo id={receipt.photoId} alt={`${photoStageLabels[receipt.details.stage]||'미분류'} · ${receipt.details.part||'기록 사진'}`}/><h3>{receipt.details.part||'부위 미기재'}</h3><p className="pre-line">{receipt.details.caption||'사진 설명 미기재'}</p></>:<p role="status">사진 접근 권한 확인 중…</p>}<div className="auth-button-row"><a className="auth-primary" href="#overview">대시보드로</a><button className="auth-secondary" onClick={onSignOut}>로그아웃</button></div></section></main>;
}
export default function WorkspaceRouter(props:ComponentProps<typeof Workspace>){
 const [hash,setHash]=useState(()=>window.location.hash);useEffect(()=>{const change=()=>setHash(window.location.hash);window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
 if(hash.startsWith('#export-photo/')){const match=hash.match(/^#export-photo\/([A-Za-z0-9_-]{1,100})\/([0-9a-f-]{36})$/i);return match?<ExportPhotoViewer record={match[1]} photo={match[2]} onSignOut={props.onSignOut}/>:<main className="auth-screen"><section className="auth-card"><h1>올바른 사진 링크를 확인하세요.</h1><a href="#overview">대시보드로</a></section></main>;}
 return <Workspace {...props}/>;
}
