import './NearbyDevices.css'

function Icon({ name, className = '' }) {
  const paths = {
    'arrow-left': 'M19 12H5m7 7-7-7 7-7',
    'refresh-cw': 'M20 11a8.1 8.1 0 0 0-14.8-4L3 10m0-5v5h5M4 13a8.1 8.1 0 0 0 14.8 4L21 14m0 5v-5h-5',
    monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
    laptop: 'M4 5h16v11H4zM2 19h20',
    smartphone: 'M7 2h10v20H7zM11 18h2',
    'alert-circle': 'M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  }
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>
}

function DeviceIcon({ device }) {
  return <span className={`device-icon${device.institutional ? ' institutional' : ''}`}><Icon name={device.kind} /></span>
}

function DeviceRow({ device, selected, onSelect }) {
  return (
    <article className={`device-row${selected ? ' selected' : ''}`}>
      <div className="device-info">
        <DeviceIcon device={device} />
        <div>
          <h2>{device.name}</h2>
          <p><span />Ready to receive</p>
        </div>
      </div>
      <button className="device-select" type="button" onClick={() => onSelect(device)}>{selected ? 'Selected' : 'Select'}</button>
    </article>
  )
}

function EmptyState({ onRefresh }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name="alert-circle" /></span>
      <h2>No nearby devices available</h2>
      <p>Make sure the receiving device has selected <strong>Receive Files</strong> and is connected to the university Wi-Fi network.</p>
      <button className="try-refresh" type="button" onClick={onRefresh}><Icon name="refresh-cw" />Try refreshing again</button>
    </div>
  )
}

export default function NearbyDevices({ onBack, onSelectDevice, onlineDevices = [], isScanning, refreshDevices }) {
  function handleSelect(device) {
    if (onSelectDevice && device) {
      onSelectDevice(device)
    }
  }

  return (
    <main className="nearby-screen">
      <header className="app-header">
        <a className="wordmark" href="#home" onClick={(event) => { event.preventDefault(); onBack() }} aria-label="Nacosdu Share home">NACOSDU-SHARE</a>
        <span className="university-badge">Dominion U</span>
        <nav className="nav-links" aria-label="Main navigation">
          <a className="active" href="#home" onClick={(event) => { event.preventDefault(); onBack() }}>Home</a>
          <a href="#recent-transfers">Recent Transfers</a>
        </nav>
      </header>
      <section className="nearby-content">
        <div className="nearby-toolbar">
          <div className="nearby-title-group">
            <button className="back-link" type="button" onClick={onBack}><Icon name="arrow-left" />Back</button>
            <h1>Nearby Devices</h1>
            <p>Select a device to send files directly over university Wi-Fi.</p>
          </div>
          <button className={`refresh-button${isScanning ? ' refreshing' : ''}`} type="button" onClick={refreshDevices} disabled={isScanning}><Icon name="refresh-cw" />Refresh List</button>
        </div>
        <div className="devices-content">
          <div className="devices-heading"><h2>Online Devices ({onlineDevices.length})</h2></div>
          {onlineDevices.length ? <div className="device-list">{onlineDevices.map((device) => <DeviceRow key={device.deviceId} device={{ ...device, kind: device.type }} selected={false} onSelect={() => handleSelect(device)} />)}</div> : <EmptyState onRefresh={refreshDevices} />}
        </div>
      </section>
    </main>
  )
}
