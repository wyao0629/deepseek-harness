import { createHash } from 'node:crypto';

// This is an accidental-deletion detector, not a shell interpreter or sandbox.
export function deletionReason(name, args) {
  if (/(?:^|[._/-])(?:delete|remove|unlink|rmdir|rm)(?:$|[._/-])/i.test(name)) return '文件删除工具';
  const values = args ?? {};
  const patch = values.patch ?? values.input ?? '';
  if (/patch/i.test(name) && typeof patch === 'string' && /^\*\*\* Delete File:/m.test(patch)) return '补丁删除文件';
  const text = [values.command, values.cmd, /python|exec|shell|bash|pwsh/i.test(name) ? values.code ?? values.script : undefined]
    .filter(value => typeof value === 'string').join('\n');
  if (/(?:^|[\s;&|()])(?:\S*\/)?(?:rm|rmdir|unlink|shred|Remove-Item|del|erase|rd)\s/i.test(text)) return '删除命令';
  if (/\bfind\b[^\n]*\s-delete\b|\bgit\s+(?:clean|rm)\b/i.test(text)) return '清理或移除文件';
  if (/\b(?:rmtree|unlink|unlinkSync|rmdir|rmdirSync|rmSync)\s*\(|\b(?:os|fs|fsp|fsPromises)\.(?:remove|rm)\s*\(/.test(text)) return '脚本中的删除调用';
  return undefined;
}

export function fingerprint(exec) {
  return createHash('sha256').update(JSON.stringify([exec.name, exec.arguments])).digest('hex');
}

export function validatePolicy(text) {
  const policy = JSON.parse(text);
  if (policy.version !== 1 || policy.deleteApproval !== 'per-call') throw new Error('invalid deletion policy');
  return policy;
}
