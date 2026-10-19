import {createRoot} from 'react-dom/client';
import AuthGate from './AuthGate';
import Workspace from './PhotoExport';
import './styles.css';
import './auth.css';
import './brand.css';

createRoot(document.getElementById('root')!).render(
  <AuthGate>{({user,profile,signOut,openAdmin,openAccount})=>
    <Workspace key={user.id} userId={user.id} userName={profile.display_name||'이름 미등록'}
      isAdmin={profile.is_admin} onSignOut={signOut} onOpenAdmin={openAdmin} onOpenAccount={openAccount}/>
  }</AuthGate>
);

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
