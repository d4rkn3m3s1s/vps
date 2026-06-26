import { env } from '../../config/env';
import type { MailMessage } from './mail.service';

// Shared branded HTML shell. Inline styles only (email clients ignore <style>).
function shell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0b0f1a;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#121826;border:1px solid #1f2937;border-radius:16px;overflow:hidden;">
      <tr><td style="padding:28px 32px 8px;">
        <div style="font-size:18px;font-weight:700;color:#fff;">VPS Fleet</div>
        <div style="font-size:12px;color:#7c8aa5;">Cloud Phone Platform</div>
      </td></tr>
      <tr><td style="padding:8px 32px 8px;">
        <h1 style="font-size:20px;color:#fff;margin:16px 0 8px;">${title}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:24px 32px 28px;border-top:1px solid #1f2937;">
        <div style="font-size:11px;color:#5b6678;">You received this email from VPS Fleet. If you weren't expecting it, you can ignore it safely.</div>
      </td></tr>
    </table>
  </td></tr></table>
  </body></html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#4F7CFF;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:600;font-size:14px;margin:14px 0;">${label}</a>`;
}

export function inviteEmail(params: { to: string; workspaceName: string; role: string; inviterEmail?: string }): MailMessage {
  const url = `${env.webBaseUrl}/login`;
  const inviter = params.inviterEmail ? `${params.inviterEmail} ` : 'An admin ';
  const html = shell(
    `You've been added to ${params.workspaceName}`,
    `<p style="color:#c5cede;font-size:14px;line-height:1.6;">${inviter}added you to the <strong>${params.workspaceName}</strong> workspace as <strong>${params.role}</strong>.</p>
     <p style="color:#c5cede;font-size:14px;line-height:1.6;">Sign in to start managing cloud phones, proxies and automations.</p>
     ${button(url, 'Open VPS Fleet')}
     <p style="color:#7c8aa5;font-size:12px;">Or paste this link: ${url}</p>`
  );
  const text = `${inviter}added you to the "${params.workspaceName}" workspace as ${params.role}.\n\nSign in: ${url}`;
  return { to: params.to, subject: `You've been added to ${params.workspaceName} on VPS Fleet`, html, text };
}

export function alertEmail(params: { to: string; title: string; detail: string; ruleName: string }): MailMessage {
  const url = `${env.webBaseUrl}/alerts`;
  const html = shell(
    params.title,
    `<p style="color:#c5cede;font-size:14px;line-height:1.6;">${params.detail}</p>
     <p style="color:#7c8aa5;font-size:12px;">Triggered by rule: <strong>${params.ruleName}</strong></p>
     ${button(url, 'View alerts')}`
  );
  const text = `${params.title}\n\n${params.detail}\n\nRule: ${params.ruleName}\nView: ${url}`;
  return { to: params.to, subject: `⚠ ${params.title} — VPS Fleet`, html, text };
}
