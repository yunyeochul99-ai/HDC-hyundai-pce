import {createRoot} from 'react-dom/client';
import AuthGate from './AuthGate';
import Workspace from './Workspace';
import './styles.css';
import './auth.css';

createRoot(document.getElementById('root')!).render(
  <AuthGate>{({user,profile,signOut,openAdmin,openAccount})=>
    <Workspace key={user.id} userId={user.id} userName={profile.display_name==='짱구'?'윤공장장':profile.display_name||'공장 구성원'}
      isAdmin={profile.is_admin} onSignOut={signOut} onOpenAdmin={openAdmin} onOpenAccount={openAccount}/>
  }</AuthGate>
);

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
