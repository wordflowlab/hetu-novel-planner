import { canonical, clone, type FixedRef } from "../domain/model.ts";

/** 只自动合并互不冲突的字段；同字段竞写必须由作者选择。 */
export function mergeFields(base: any, local: any, remote: any) {
  const value = clone(remote), conflicts: {field: string; base: any; local: any; remote: any}[] = [];
  for (const field of Object.keys(local)) {
    if (canonical(base?.[field]) === canonical(local[field])) continue;
    if (canonical(base?.[field]) !== canonical(remote?.[field]) && canonical(local[field]) !== canonical(remote?.[field])) {
      conflicts.push({field, base:base?.[field], local:local[field], remote:remote?.[field]});
    } else value[field] = clone(local[field]);
  }
  return {value, conflicts};
}

export type Saved = { object: any; sha256: string };
export const fixedRef = (r: Saved): FixedRef => ({
  object_id: r.object.object_id,
  revision: r.object.revision,
  sha256: r.sha256,
});
type Step = {
  action: string;
  input: any;
  attach?: { role: string; node_id?: string };
};
export type Pending = Step & { plan_base?: FixedRef; next?: Step };

/** 每一步都先保存确切输入；回执丢失时由专业动作沿原键查询。 */
export async function settleFlow(
  initial: Pending,
  context: {
    invoke(action: string, input: any): Promise<Saved>;
    persist(pending: Pending | null): Promise<void>;
    key(): string;
  },
) {
  let p = initial,
    first: Saved | undefined,
    last: Saved | undefined;
  for (;;) {
    await context.persist(p);
    const result = await context.invoke(p.action, p.input);
    first ??= result;
    last = result;
    const base =
      result.object.kind === "novel_plan" ? fixedRef(result) : p.plan_base;
    if (p.next) {
      p = { ...p.next, plan_base: base };
      continue;
    }
    if (p.attach) {
      if (!base) throw new Error("缺少固定方案基线，已保存成果保持待接入。");
      p = {
        action: "attach_object",
        input: {
          object_id: base.object_id,
          expected_revision: base.revision,
          expected_sha256: base.sha256,
          operation_key: context.key(),
          ...p.attach,
          target: fixedRef(result),
        },
        plan_base: base,
      };
      continue;
    }
    await context.persist(null);
    return { result: first, last };
  }
}
