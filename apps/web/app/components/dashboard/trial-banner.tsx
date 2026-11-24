
type Props =
  | { variant: 'active'; tierName: string; endsAt: string }
  | { variant: 'expired'; tierName: string };

export function TrialBanner(props: Props) {
  if (props.variant === 'active') {
    const ends = new Date(props.endsAt);
    const days = Math.ceil((ends.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return (
      <div
        className="card"
        style={{
          marginBottom: 20,
          padding: '14px 18px',
          borderColor: 'rgba(255,122,61,0.40)',
          background:
            'linear-gradient(180deg, rgba(255,122,61,0.10), var(--surface))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          <strong>Zkušební období</strong> · vyprší za{' '}
          <strong>{days} {days === 1 ? 'den' : days < 5 ? 'dny' : 'dní'}</strong>{' '}
          ({ends.toLocaleDateString('cs-CZ')}).{' '}
          <span className="muted" style={{ fontSize: 12 }}>
            Po expiraci se shop pozastaví. Vyberte tarif včas.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="card"
      style={{
        marginBottom: 20,
        padding: 32,
        borderColor: 'rgba(239,68,68,0.40)',
        background: 'rgba(239,68,68,0.05)',
        textAlign: 'center',
      }}
    >
      <h2 className="heading-2" style={{ margin: '0 0 12px', fontSize: 20 }}>
        Zkušební období vypršelo
      </h2>
      <p className="muted" style={{ margin: '0 auto', maxWidth: 520 }}>
        Tarif „{props.tierName}“ je neaktivní — MCP volání jsou pozastavena.
        Data
        držíme 30 dní pro případnou reaktivaci.
      </p>
    </div>
  );
}
