import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import './workspace-catalog.css';

export const marketplaceAuthenticationErrors=new Set(['marketplace_auth','ghes_login_required','ghes_session_expired','ghes_sso_required','ghes_session_changed','ghes_identity_changed']);
export function marketplaceRequiresLogin(catalog,code){
  return marketplaceAuthenticationErrors.has(code)||catalog?.loginRequired===true||catalog?.credentialsReady===false||(catalog?.credentialsReady===undefined&&catalog?.connected===false);
}

export function CompanySkillSignIn({busy,onConnect}){
  return <div className="nubi-catalog-signin">
    <Icon name="githubMark" size={24}/>
    <div className="nubi-catalog-signin-copy"><strong>사내 Github SSO</strong><span>팀의 AI Agent 경험을 누려보세요.</span></div>
    <CxButton disabled={busy} onClick={onConnect}><Icon name="githubMark" size={16}/><span>로그인</span></CxButton>
  </div>;
}
