/** S05 CM targets (F10): list + editor, routes `/targets` and `/targets/:id`. */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { AptKey, CmTarget, Grade, StatKey } from '@uma/schema';
import { Page } from '../components/Layout.tsx';
import { Empty, ErrorBanner, Loading } from '../components/atoms.tsx';
import { useDeleteTarget, useMaster, useSaveTarget, useTargets } from '../app/queries.ts';
import { errorText } from '../api/errors.ts';
import { skillName, type MasterData } from '../master/load.ts';
import { APT_KEYS, APT_LABEL, GRADES, STAT_KEYS, STAT_LABEL } from '../lib/keys.ts';
import { blankDraft, draftFromTarget, validateDraft, type TargetDraft } from '../lib/targets.ts';
import { titleCase } from '../lib/format.ts';

export function TargetsScreen() {
  const { id } = useParams();
  const targets = useTargets();
  const master = useMaster();
  const navigate = useNavigate();
  const list = targets.data;
  const selected = id && id !== 'new' ? list?.find((t) => t.id === id) : undefined;
  const isNew = id === 'new' || (!id && list?.length === 0);

  useEffect(() => {
    if (!id && list && list.length > 0) void navigate(`/targets/${list[0]!.id}`, { replace: true });
  }, [id, list, navigate]);

  const actions = (
    <Link className="btn primary" to="/targets/new">
      + New target
    </Link>
  );
  let body;
  if (targets.isError) body = <ErrorBanner text={errorText(targets.error)} onRetry={() => void targets.refetch()} />;
  else if (!list || !master.data) body = <Loading label="Loading targets…" />;
  else
    body = (
      <div className="split">
        <section className="panel" aria-labelledby="tl">
          <header id="tl">Saved targets</header>
          {list.length === 0 ? (
            <Empty>
              <p>No targets yet. Create one to start ranking parents.</p>
            </Empty>
          ) : (
            <div className="queue">
              {list.map((t) => (
                <Link key={t.id} to={`/targets/${t.id}`} aria-current={t.id === selected?.id ? 'true' : undefined}>
                  <b>{t.name}</b>
                  {/* CmTarget has no timestamps in the API response (Q-72): no "updated" date. */}
                  <small>
                    {titleCase(t.course.surface)} · {t.course.distance}
                    {t.course.meters !== undefined ? ` · ${t.course.meters} m` : ''}
                  </small>
                </Link>
              ))}
            </div>
          )}
        </section>
        {selected || isNew ? (
          <Editor key={selected?.id ?? 'new'} target={selected ?? null} m={master.data} />
        ) : id ? (
          <Empty>
            <p>That target no longer exists.</p>
          </Empty>
        ) : null}
      </div>
    );
  return (
    <Page title="CM targets" actions={actions}>
      {body}
    </Page>
  );
}

function Editor({ target, m }: { target: CmTarget | null; m: MasterData }) {
  const [d, setD] = useState<TargetDraft>(() => (target ? draftFromTarget(target) : blankDraft()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const save = useSaveTarget();
  const del = useDeleteTarget();
  const navigate = useNavigate();
  const set = (p: Partial<TargetDraft>) => setD((x) => ({ ...x, ...p }));

  const submit = (asNew: boolean) => {
    const r = validateDraft(d, m);
    setErrors(r.errors);
    if (!r.input) return;
    save.mutate(
      { id: asNew ? null : (target?.id ?? null), input: r.input },
      {
        onSuccess: (t) => {
          setToast(`Saved “${t.name}”.`);
          if (t.id !== target?.id) void navigate(`/targets/${t.id}`);
        },
      },
    );
  };
  const err = (k: string) => errors[k];
  const errProps = (k: string) =>
    err(k) ? { 'aria-invalid': true as const, 'aria-describedby': `e-${k.replace('.', '-')}` } : {};
  const ErrMsg = ({ k }: { k: string }) =>
    err(k) ? (
      <span className="err-text" id={`e-${k.replace('.', '-')}`}>
        {err(k)}
      </span>
    ) : null;

  return (
    <section className="panel" aria-labelledby="ed-t">
      <header id="ed-t">{target ? 'Edit target' : 'New target'}</header>
      <form
        className="body grid"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <label className="field" style={{ maxWidth: 360 }}>
          <span>Name</span>
          <input className="input" value={d.name} onChange={(e) => set({ name: e.target.value })} {...errProps('name')} />
          <ErrMsg k="name" />
        </label>
        <fieldset className="grid" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="hint">Course</legend>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <label className="field">
              <span>Surface</span>
              <select className="input" value={d.surface} onChange={(e) => set({ surface: e.target.value as TargetDraft['surface'] })}>
                <option value="turf">Turf</option>
                <option value="dirt">Dirt</option>
              </select>
            </label>
            <label className="field">
              <span>Distance</span>
              <select className="input" value={d.distance} onChange={(e) => set({ distance: e.target.value as TargetDraft['distance'] })}>
                {(['sprint', 'mile', 'medium', 'long'] as const).map((x) => (
                  <option key={x} value={x}>
                    {titleCase(x)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Meters (optional)</span>
              <input className="input w-sm" inputMode="numeric" value={d.meters} onChange={(e) => set({ meters: e.target.value })} {...errProps('meters')} />
              <ErrMsg k="meters" />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Notes</span>
              <input className="input" value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
            </label>
          </div>
        </fieldset>
        <div className="field">
          <span id="style-l">Running style</span>
          <div className="seg" role="radiogroup" aria-labelledby="style-l">
            {(['front', 'pace', 'late', 'end'] as const).map((s) => (
              <label key={s}>
                <input type="radio" name="style" checked={d.style === s} onChange={() => set({ style: s })} />
                {titleCase(s)}
              </label>
            ))}
          </div>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="hint">Minimum stats (blank = no requirement)</legend>
          <div className="form3">
            {STAT_KEYS.map((k: StatKey) => (
              <label key={k} className="field">
                <span>{STAT_LABEL[k]}</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={d.minStats[k]}
                  onChange={(e) => set({ minStats: { ...d.minStats, [k]: e.target.value } })}
                  {...errProps(`minStats.${k}`)}
                />
                <ErrMsg k={`minStats.${k}`} />
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="hint">Minimum aptitudes</legend>
          <div className="aptgrid">
            {APT_KEYS.map((k: AptKey) => (
              <label key={k} className="field">
                <span>{APT_LABEL[k]}</span>
                <select
                  className="input"
                  value={d.minAptitudes[k]}
                  onChange={(e) => set({ minAptitudes: { ...d.minAptitudes, [k]: e.target.value as Grade | '' } })}
                >
                  <option value="">—</option>
                  {[...GRADES].reverse().map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <span id="req-l">Required skills (all must be acquired)</span>
          <div className="row" style={{ gap: 6 }}>
            {d.requiredSkills.map((s) => (
              <span key={s} className="chip sel">
                {skillName(m, s)}
                <button type="button" aria-label={`Remove ${skillName(m, s)}`} onClick={() => set({ requiredSkills: d.requiredSkills.filter((x) => x !== s) })}>
                  ✕
                </button>
              </span>
            ))}
            <SkillInput
              m={m}
              labelledBy="req-l"
              exclude={new Set([...d.requiredSkills, ...d.optionalSkills.map((o) => o.skillId)])}
              onAdd={(s) => set({ requiredSkills: [...d.requiredSkills, s] })}
              onBackspace={() => set({ requiredSkills: d.requiredSkills.slice(0, -1) })}
            />
          </div>
          <ErrMsg k="requiredSkills" />
        </div>
        <div className="field">
          <span id="opt-l">Optional skills (weight for secondary sort)</span>
          <div className="row" style={{ gap: 6 }}>
            {d.optionalSkills.map((o, i) => (
              <span key={o.skillId} className="chip">
                {skillName(m, o.skillId)}
                <input
                  className="input w-sm"
                  style={{ height: 22, width: 52 }}
                  aria-label={`Weight for ${skillName(m, o.skillId)}`}
                  inputMode="decimal"
                  value={o.weight}
                  onChange={(e) =>
                    set({ optionalSkills: d.optionalSkills.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)) })
                  }
                  {...errProps(`optionalSkills.${i}`)}
                />
                <button
                  type="button"
                  aria-label={`Remove ${skillName(m, o.skillId)}`}
                  onClick={() => set({ optionalSkills: d.optionalSkills.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
                <ErrMsg k={`optionalSkills.${i}`} />
              </span>
            ))}
            <SkillInput
              m={m}
              labelledBy="opt-l"
              exclude={new Set([...d.requiredSkills, ...d.optionalSkills.map((o) => o.skillId)])}
              onAdd={(s) => set({ optionalSkills: [...d.optionalSkills, { skillId: s, weight: '1' }] })}
              onBackspace={() => set({ optionalSkills: d.optionalSkills.slice(0, -1) })}
            />
          </div>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="hint">Stat weights for surplus (default 1)</legend>
          <div className="form3">
            {STAT_KEYS.map((k) => (
              <label key={k} className="field">
                <span>{STAT_LABEL[k]}</span>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="1"
                  value={d.statWeights[k]}
                  onChange={(e) => set({ statWeights: { ...d.statWeights, [k]: e.target.value } })}
                  {...errProps(`statWeights.${k}`)}
                />
                <ErrMsg k={`statWeights.${k}`} />
              </label>
            ))}
          </div>
        </fieldset>
        {save.isError && <ErrorBanner text={<>Couldn't save the target. Retry. {errorText(save.error)}</>} />}
        {del.isError && <ErrorBanner text={errorText(del.error)} />}
        <div className="row">
          <button type="submit" className="btn primary" disabled={save.isPending} aria-busy={save.isPending}>
            Save target
          </button>
          {target && (
            <button type="button" className="btn" disabled={save.isPending} onClick={() => submit(true)}>
              Save as new
            </button>
          )}
          {target && (
            <button type="button" className="btn danger" onClick={() => setConfirm(true)}>
              Delete
            </button>
          )}
          {toast && (
            <span role="status" className="hint">
              {toast}
            </span>
          )}
        </div>
      </form>
      {confirm && target && (
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="del-tt">
          <div>
            <h2 id="del-tt">Delete “{target.name}”? This can't be undone.</h2>
            <div className="row">
              <button type="button" className="btn" autoFocus onClick={() => setConfirm(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={del.isPending}
                onClick={() =>
                  del.mutate(target.id, {
                    onSuccess: () => {
                      setConfirm(false);
                      void navigate('/targets');
                    },
                    onError: () => setConfirm(false),
                  })
                }
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** SkillChipInput: autocomplete over vocab (kind `skill`); Enter adds, Backspace on empty removes. */
function SkillInput({
  m,
  labelledBy,
  exclude,
  onAdd,
  onBackspace,
}: {
  m: MasterData;
  labelledBy: string;
  exclude: ReadonlySet<string>;
  onAdd: (skillId: string) => void;
  onBackspace: () => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listId = `${labelledBy}-list`;
  const options = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const seen = new Set<string>();
    const out: { id: string; text: string }[] = [];
    for (const e of m.bundle.vocab) {
      if (e.kind !== 'skill' || seen.has(e.id) || exclude.has(e.id)) continue;
      if (!m.skills.has(e.id)) continue;
      if (e.text.toLowerCase().includes(s)) {
        seen.add(e.id);
        out.push({ id: e.id, text: e.text });
        if (out.length >= 8) break;
      }
    }
    return out;
  }, [q, m, exclude]);
  const pick = (id: string) => {
    onAdd(id);
    setQ('');
    setActive(0);
  };
  return (
    <div className="ac">
      <input
        className="input"
        placeholder="Add skill…"
        role="combobox"
        aria-labelledby={labelledBy}
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const o = options[active];
            if (o) pick(o.id);
          } else if (e.key === 'Backspace' && q === '') onBackspace();
        }}
      />
      {q.trim().length >= 2 && (
        <div className="suggest" role="listbox" id={listId}>
          {options.length === 0 ? (
            <div className="muted" style={{ padding: 6 }}>
              No skills match
            </div>
          ) : (
            options.map((o, i) => (
              <div
                key={o.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o.id);
                }}
              >
                {o.text}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
