import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import './workspace-catalog.css';

export const marketplaceAuthenticationErrors=new Set(['marketplace_auth','ghes_login_required','ghes_session_expired','ghes_sso_required','ghes_session_changed','ghes_identity_changed']);
export function marketplaceRequiresLogin(catalog,code){
  return marketplaceAuthenticationErrors.has(code)||catalog?.loginRequired===true||catalog?.credentialsReady===false||(catalog?.credentialsReady===undefined&&catalog?.connected===false);
}

export function CompanySkillSignIn({busy,onConnect}){
  return <div className="nubi-skill-signin">
    <p>팀의 AI Agent 경험을 누려보세요.</p>
    <CxButton className="nubi-skill-signin-button" disabled={busy} onClick={onConnect}><Icon name="githubMark" size={20}/><span>사내 Github SSO 로그인</span></CxButton>
  </div>;
}
