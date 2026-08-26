import { useEffect, useState } from 'react'
import init, {
  compare,
  decode,
  decodeTime,
  encode,
  encodeTime,
  generateMany,
  generateUuidV7Many,
  isValid,
  monotonicUlid,
  ulid,
  ulidToUuid,
  uuidv7,
  uuidv7Time,
  version,
} from './rivid-wasm/rivid_wasm.js'

const FMT = /^[0-9A-HJKMNP-TV-Z]{26}$/

interface CheckRow {
  name: string
  ok: boolean
}

function runSelfTests(): CheckRow[] {
  const rows: CheckRow[] = []
  const t = (name: string, ok: boolean) => rows.push({ name, ok })

  const id = ulid()
  t('ulid() matches Crockford format', FMT.test(id))
  t('seedTime pins timestamp prefix', ulid(1469918176385).slice(0, 10) === '01ARYZ6S41')
  t('decodeTime vector', decodeTime('01ARZ3NDEKTSV4RRFFQ69G5FAV') === 1469922850259)
  t('encodeTime vector', encodeTime(1469918176385) === '01ARYZ6S41')
  t('isValid accepts canonical', isValid(id))
  t('isValid rejects truncated', !isValid(id.slice(1)))

  const bytes = decode(id)
  t('encode(decode(x)) round trip', new Uint8Array(bytes).length === 16 && encode(bytes) === id)

  const m = [monotonicUlid(150000), monotonicUlid(150000), monotonicUlid(150000)]
  t('monotonic strict increase', m[0] < m[1] && m[1] < m[2])
  t('compare ordering', compare(m[0], m[2]) === -1)

  const u7 = uuidv7()
  t('uuidv7 version nibble', /^.{14}7/.test(u7))
  t('uuidv7 timestamp ≈ now', Math.abs(uuidv7Time(hexToBytes(u7)) - Date.now()) < 5000)
  t('ulidToUuid shape', /^[0-9A-F-]{36}$/.test(ulidToUuid(id)))
  t('bulk 10k unique', new Set(generateMany(10000)).size === 10000)
  t('uuidv7 bulk', generateUuidV7Many(100).length === 100)

  return rows
}

function hexToBytes(uuid: string): Uint8Array {
  const hex = uuid.replaceAll('-', '')
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checks, setChecks] = useState<CheckRow[]>([])
  const [engineMs, setEngineMs] = useState(0)

  const [single, setSingle] = useState('')
  const [monoList, setMonoList] = useState<string[]>([])
  const [bulk, setBulk] = useState<{ ms: number; ids: string[] } | null>(null)
  const [v7, setV7] = useState('')
  const [validateInput, setValidateInput] = useState('01ARZ3NDEKTSV4RRFFQ69G5FAV')

  useEffect(() => {
    init()
      .then(() => {
        const t0 = performance.now()
        setChecks(runSelfTests())
        setEngineMs(performance.now() - t0)
        setSingle(ulid())
        setV7(uuidv7())
        setReady(true)
      })
      .catch((e) => setError(String(e)))
  }, [])

  if (error) {
    return <p style={{ color: 'crimson', fontFamily: 'monospace' }}>wasm init failed: {error}</p>
  }

  const allPass = ready && checks.every((c) => c.ok)

  return (
    <main style={styles.page}>
      <h1 style={styles.h1}>rivid-wasm × React</h1>
      <p style={styles.sub}>
        {ready ? `loaded · engine v${version()} · ${navigator.userAgent.includes('Chrome') ? 'Chromium' : 'browser'} runtime` : 'loading wasm…'}
      </p>

      <section style={styles.card}>
        <h2 style={styles.h2}>Self-test — spec vectors executed in-browser</h2>
        {!ready && <p>running…</p>}
        {ready && (
          <>
            <p style={{ color: allPass ? 'green' : 'crimson', fontWeight: 700 }}>
              {allPass ? `ALL ${checks.length} CHECKS PASS` : 'FAILURES PRESENT'} · {engineMs.toFixed(1)} ms
            </p>
            <table style={styles.table}>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.name}>
                    <td>{c.ok ? '✅' : '❌'}</td>
                    <td style={styles.mono}>{c.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <div style={styles.grid}>
        <section style={styles.card}>
          <h2 style={styles.h2}>Single ULID</h2>
          <button style={styles.btn} disabled={!ready} onClick={() => setSingle(ulid())}>
            generate
          </button>
          <p style={styles.mono}>{single || '—'}</p>
          {single && (
            <p style={styles.dim}>
              time component → {new Date(decodeTime(single)).toISOString()}
            </p>
          )}
        </section>

        <section style={styles.card}>
          <h2 style={styles.h2}>Monotonic stream</h2>
          <button
            style={styles.btn}
            disabled={!ready}
            onClick={() => setMonoList((l) => [...l.slice(-4), monotonicUlid()])}
          >
            next
          </button>
          {monoList.map((m) => (
            <p key={m} style={styles.mono}>{m}</p>
          ))}
        </section>

        <section style={styles.card}>
          <h2 style={styles.h2}>Bulk ×10,000</h2>
          <button
            style={styles.btn}
            disabled={!ready}
            onClick={() => {
              const t0 = performance.now()
              const ids = generateMany(10000)
              setBulk({ ms: performance.now() - t0, ids })
            }}
          >
            run
          </button>
          {bulk && (
            <>
              <p>{bulk.ms.toFixed(1)} ms total</p>
              {(Math.round(10000 / (bulk.ms / 1000))).toLocaleString()} ids/sec
              <p style={styles.dim}>first: <span style={styles.mono}>{bulk.ids[0]}</span></p>
            </>
          )}
        </section>

        <section style={styles.card}>
          <h2 style={styles.h2}>UUIDv7</h2>
          <button style={styles.btn} disabled={!ready} onClick={() => setV7(uuidv7())}>
            generate
          </button>
          <p style={styles.mono}>{v7 || '—'}</p>
        </section>
      </div>

      <section style={styles.card}>
        <h2 style={styles.h2}>Validator</h2>
        <input
          style={{ ...styles.input, borderColor: validateInput && ready ? (isValid(validateInput) ? 'green' : 'crimson') : '#ccc' }}
          value={validateInput}
          onChange={(e) => setValidateInput(e.target.value)}
          placeholder="paste a ULID"
        />
        <p>{ready && (isValid(validateInput) ? '✅ valid ULID' : '❌ invalid')}</p>
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 720, margin: '2rem auto', fontFamily: 'system-ui, sans-serif', padding: '0 1rem' },
  h1: { marginBottom: 0 },
  sub: { color: '#666', marginTop: 4 },
  h2: { fontSize: '1rem', marginTop: 0 },
  card: { border: '1px solid #ddd', borderRadius: 10, padding: '1rem 1.25rem', margin: '1rem 0' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' },
  btn: { padding: '.45rem 1rem', cursor: 'pointer', borderRadius: 6, border: '1px solid #888', background: '#f6f6f6' },
  mono: { fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all', margin: '.4rem 0' },
  dim: { color: '#777', fontSize: '.85rem' },
  table: { width: '100%', fontSize: '.85rem' },
  input: { width: '100%', padding: '.5rem', borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box' },
}
