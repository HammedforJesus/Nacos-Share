import { useEffect, useMemo, useRef, useState } from 'react'
import './Home.css'
import NearbyDevices from './NearbyDevices.jsx'
import useFileTransfer from './hooks/useFileTransfer.jsx'

function UploadIcon() {
  return <svg className="transfer-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14" /></svg>
}

function DownloadIcon() {
  return <svg className="transfer-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14" /></svg>
}

function ShareIcon() {
  return (
    <svg className="share-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.5 11.2l7-4.2M8.5 12.8l7 4.2" />
    </svg>
  )
}

function FileTypeIcon({ extension }) {
  const normalized = (extension || 'file').toLowerCase()
  const commonProps = { viewBox: '0 0 24 24', 'aria-hidden': 'true', className: 'file-type-svg' }

  if (normalized === 'pdf') {
    return (
      <svg {...commonProps}>
        <path d="M7 3.5h7l5 5V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2z" />
        <path d="M14 3.5v5h5" />
        <path d="M8 13h2.5a1.5 1.5 0 1 1 0 3H8zm0 0v-2.5m4.5 2.5H12.5a1.5 1.5 0 0 0 0-3h-1.5" />
      </svg>
    )
  }

  if (normalized === 'docx' || normalized === 'doc') {
    return (
      <svg {...commonProps}>
        <path d="M7 3.5h7l5 5V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2z" />
        <path d="M14 3.5v5h5" />
        <path d="M9 12h6M9 15h6" />
      </svg>
    )
  }

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(normalized)) {
    return (
      <svg {...commonProps}>
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <circle cx="9" cy="9.5" r="1.8" />
        <path d="M20.5 15l-4.2-4.2a1.5 1.5 0 0 0-2.1 0L9 15l-1.2-1.2a1.5 1.5 0 0 0-2.1 0L3.5 15" />
      </svg>
    )
  }

  return (
    <svg {...commonProps}>
      <path d="M7 3.5h7l5 5V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2z" />
      <path d="M14 3.5v5h5" />
      <path d="M8 14h8M8 11h8" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="trash-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3m-8 0 1 12h8l1-12" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  )
}

function Header({ onHome, activePage = 'home', onRecentTransfers }) {
  return (
    <header className="app-header">
      <a className="wordmark" href="#home" onClick={(event) => { event.preventDefault(); onHome() }} aria-label="Nacosdu Share home">NACOSDU-SHARE</a>
      <span className="university-badge">Dominion U</span>
      <nav className="nav-links" aria-label="Main navigation">
        <a className={activePage === 'home' ? 'active' : ''} href="#home" onClick={(event) => { event.preventDefault(); onHome() }}>Home</a>
        <a className={activePage === 'recent' ? 'active' : ''} href="#recent-transfers" onClick={(event) => { event.preventDefault(); onRecentTransfers?.() }}>Recent Transfers</a>
      </nav>
    </header>
  )
}

function TransferLogIcon() {
  return <span className="transfer-log-icon"><UploadIcon /></span>
}

function RecentTransfers({ onHome, transferHistory }) {
  const [filter, setFilter] = useState('sent')
  const [selectedLog, setSelectedLog] = useState(null)
  const logs = transferHistory.filter((log) => log.direction === filter)

  return (
    <main className="recent-screen">
      <Header onHome={onHome} activePage="recent" onRecentTransfers={() => setFilter('sent')} />
      <section className="recent-content" aria-labelledby="recent-title">
        <div className="recent-top-row">
          <div className="recent-heading">
            <h1 id="recent-title">Recent Transfers</h1>
            <p>Review and audit your previous file transmission activity.</p>
          </div>
          <div className="transfer-filter" role="tablist" aria-label="Transfer direction">
            <button type="button" className={filter === 'sent' ? 'selected' : ''} role="tab" aria-selected={filter === 'sent'} onClick={() => setFilter('sent')}>Sent</button>
            <button type="button" className={filter === 'received' ? 'selected' : ''} role="tab" aria-selected={filter === 'received'} onClick={() => setFilter('received')}>Received</button>
          </div>
        </div>

        <div className="transfer-log-list" role="list">
          {logs.length ? logs.map((log) => (
            <button type="button" className="transfer-log-row" key={log.id} onClick={() => setSelectedLog(log)}>
              <span className="transfer-log-left"><TransferLogIcon /><span className="transfer-log-meta"><strong>{log.fileName}</strong><span>{filter === 'sent' ? 'To' : 'From'}: {log.peerDeviceName || 'Unknown device'} · {new Date(log.timestamp).toLocaleString()}</span></span></span>
              <span className="transfer-log-right"><strong>{formatSize(log.fileSize)}</strong><span className={`status-badge ${log.status.toLowerCase()}`}>{log.status}</span></span>
            </button>
          )) : <div className="empty-file-list">No completed {filter} transfers yet.</div>}
        </div>
      </section>
      {selectedLog && <div className="transfer-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="transfer-detail-title"><div className="drawer-header"><h2 id="transfer-detail-title">Transfer Details</h2><button type="button" aria-label="Close transfer details" onClick={() => setSelectedLog(null)}>×</button></div><p><strong>{selectedLog.fileName}</strong></p><p>{filter === 'sent' ? 'Recipient' : 'Sender'}: {selectedLog.peerDeviceName || 'Unknown device'}</p><p>Delivery status: <strong>{selectedLog.status}</strong></p></div>}
    </main>
  )
}

function TransferCard({ title, description, action, icon, featured, onAction }) {
  return (
    <article className={`transfer-card${featured ? ' featured' : ''}`}>
      <div className="card-heading"><span className={`icon-container${featured ? ' send-icon' : ' receive-icon'}`}>{icon}</span><h2>{title}</h2></div>
      <p>{description}</p>
      <button type="button" className="card-action" onClick={onAction}>{action}</button>
    </article>
  )
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  const rounded = value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)
  return `${rounded} ${units[index]}`
}

function getExtension(fileName) {
  const match = fileName.match(/\.([a-z0-9]+)$/i)
  return match ? match[1] : 'file'
}

function FileSelection({ onHome, onContinue, selectedFiles, setSelectedFiles }) {
  const inputRef = useRef(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const totalSize = useMemo(() => selectedFiles.reduce((sum, file) => sum + file.size, 0), [selectedFiles])

  function addFiles(newFiles) {
    if (!newFiles?.length) return

    const mapped = Array.from(newFiles).map((file, index) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${index}`,
      name: file.name,
      size: file.size,
      extension: getExtension(file.name),
      type: file.type,
      nativeFile: file,
    }))

    setSelectedFiles((current) => [...current, ...mapped])
  }

  function handleRemoveFile(fileId) {
    setSelectedFiles((current) => current.filter((file) => file.id !== fileId))
  }

  return (
    <main className="file-selection-screen">
      <Header onHome={onHome} />
      <section className="file-selection-content" aria-labelledby="file-selection-title">
        <header className="file-selection-header">
          <h1 id="file-selection-title">Select Files to Send</h1>
          <p>Drag and drop multiple files from your device to share them with a nearby recipient.</p>
        </header>

        <div className="file-selection-workspace">
          <div
            className={`drop-zone${isDragOver ? ' drag-over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragOver(true)
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setIsDragOver(false)
              addFiles(event.dataTransfer.files)
            }}
          >
            <div className="upload-icon-bubble" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="upload-bubble-svg">
                <path d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14" />
              </svg>
            </div>
            <div className="drop-zone-text">
              <h2>Drag and drop your files here</h2>
              <p>or browse from local system storage</p>
            </div>
            <button type="button" className="choose-files-btn" onClick={() => inputRef.current?.click()}>
              Choose Files
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(event) => {
                addFiles(event.target.files)
                event.target.value = ''
              }}
            />
          </div>

          <aside className="selected-list-card">
            <div className="selected-header">
              <h2>Selected Files</h2>
              <span className="active-pill">{selectedFiles.length} Active</span>
            </div>

            <div className="file-list-scroll" role="list" aria-label="Selected file list">
              {selectedFiles.length === 0 ? (
                <div className="empty-file-list">No files selected</div>
              ) : (
                selectedFiles.map((file) => (
                  <div key={file.id} className="file-row" role="listitem">
                    <div className="file-row-main">
                      <span className={`file-type-badge ${file.extension}`}>
                        <FileTypeIcon extension={file.extension} />
                      </span>
                      <div className="file-meta">
                        <span className="file-name">{file.name}</span>
                        <span className="file-size">{formatSize(file.size)}</span>
                      </div>
                    </div>
                    <button type="button" className="file-delete" aria-label={`Remove ${file.name}`} onClick={() => handleRemoveFile(file.id)}>
                      <TrashIcon />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="selected-divider" />

            <div className="summary-footer">
              <div className="total-size-row">
                <span>Total Size</span>
                <strong>{formatSize(totalSize)}</strong>
              </div>
              <button type="button" className="continue-button" disabled={selectedFiles.length === 0} onClick={onContinue}>
                Continue
              </button>
            </div>
          </aside>
        </div>
      </section>
    </main>
  )
}

function LaptopIcon() {
  return (
    <svg className="device-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16v10H4zM2 18h20" />
    </svg>
  )
}

function ReviewTransferDetails({ selectedDevice, selectedFiles, onHome, onBack, onSend }) {
  const totalSize = useMemo(() => selectedFiles.reduce((sum, file) => sum + file.size, 0), [selectedFiles])

  return (
    <main className="review-screen">
      <Header onHome={onHome} />
      <section className="review-content" aria-labelledby="review-title">
        <header className="review-header">
          <h1 id="review-title">Review Transfer Details</h1>
          <p>Confirm the designated recipient and the final payload before sending.</p>
        </header>

        <div className="review-workspace">
          <article className="review-card recipient-card">
            <div className="card-label">TARGET RECIPIENT</div>
            <div className="recipient-header-row">
              <div className="avatar-circle">DA</div>
              <div className="recipient-meta">
                <h2>{selectedDevice?.name || 'No device selected'}</h2>
                <p>{selectedDevice?.type || 'Unknown device type'}</p>
              </div>
            </div>
            <div className="detail-divider" />
            <div className="device-info-row">
              <div className="device-pill-icon"><LaptopIcon /></div>
              <div className="device-text-block">
                <span className="device-name">{selectedDevice?.name || 'No device selected'}</span>
                <span className="device-status">Verified and ready</span>
              </div>
            </div>
          </article>

          <article className="review-card package-card">
            <div className="package-header">
              <h2>Transmission Package</h2>
              <span className="package-pill">{selectedFiles.length} files</span>
            </div>

            <div className="package-list" role="list" aria-label="Transmission package list">
              {selectedFiles.map((file) => (
                <div key={file.id} className="package-file-row" role="listitem">
                  <div className="package-file-left">
                    <span className={`file-type-badge ${file.extension}`}>
                      <FileTypeIcon extension={file.extension} />
                    </span>
                    <div className="file-meta">
                      <span className="file-name">{file.name}</span>
                      <span className="file-size">{formatSize(file.size)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="detail-divider" />

            <div className="summary-footer review-summary">
              <span>Payload Total</span>
              <strong>{formatSize(totalSize)}</strong>
            </div>
          </article>
        </div>

        <div className="review-actions">
          <button type="button" className="back-button" onClick={onBack}>Back</button>
          <button type="button" className="send-button" onClick={onSend}>Send Files</button>
        </div>
      </section>
    </main>
  )
}

function WaitingForApproval({ selectedDevice, selectedFiles, onHome, onCancel, status, progress, error }) {
  const totalFiles = selectedFiles.length
  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0)

  return (
    <main className="approval-screen">
      <Header onHome={onHome} />
      <section className="approval-content" aria-labelledby="approval-title">
        <div className="approval-status-block">
          <div className="radar-graphic radar-green" aria-hidden="true">
            <span className="radar-ring outer" />
            <span className="radar-ring middle" />
            <span className="radar-ring inner" />
            <span className="radar-center-icon">
              <LaptopIcon />
            </span>
          </div>

          <div className="approval-copy">
            <h1 id="approval-title">{status === 'sending' ? 'Sending Files' : status === 'declined' ? 'Transfer declined' : status === 'error' ? 'Transfer could not start' : status === 'cancelled' ? 'Transfer cancelled' : 'Waiting for approval'}</h1>
            <p>
              {status === 'sending' ? <>Sending files to <strong>{selectedDevice?.name || 'the selected device'}</strong>.</> : status === 'declined' || status === 'error' || status === 'cancelled' ? <strong>{error || 'The transfer did not complete.'}</strong> : <>Your transfer request to <strong>{selectedDevice?.name || 'the selected device'}</strong> is awaiting confirmation.</>}
            </p>
          </div>

          <div className="payload-pill" aria-label={`Transfer payload summary: ${totalFiles} files, ${formatSize(totalSize)}`}>
            <svg className="payload-pill-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3.5h7l5 5V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2z" />
              <path d="M14 3.5v5h5M8 11h8M8 14h8" />
            </svg>
            <span>{totalFiles} files · {formatSize(totalSize)}</span>
          </div>

          <button type="button" className="cancel-transfer-button" onClick={onCancel}>Cancel Transfer</button>
          {error && <p role="alert">{error}</p>}
          {status === 'sending' && <p role="status">{Math.round(progress)}% sent</p>}
        </div>
      </section>
    </main>
  )
}

function IncomingFileTransfer({ incomingTransfer, onDecline, onAccept }) {
  const files = incomingTransfer?.files?.map((file, index) => ({ ...file, id: `${incomingTransfer.transferId}-${index}`, extension: getExtension(file.name) })) || []
  const totalSize = files.reduce((sum, file) => sum + file.size, 0)

  return (
    <main className="incoming-screen">
      <Header onHome={onDecline} />
      <section className="incoming-content" aria-labelledby="incoming-title">
        <header className="incoming-header">
          <h1 id="incoming-title">Incoming File Transfer</h1>
          <p>A nearby user wishes to share files with you.</p>
        </header>

        <div className="incoming-workspace">
          <article className="incoming-card">
            <div className="sender-info-row">
              <div className="sender-icon-badge"><LaptopIcon /></div>
              <div className="sender-text">
                <span>SENDER DEVICE</span>
                <strong>{incomingTransfer?.senderName || 'Nearby device'}</strong>
              </div>
            </div>

            <div className="detail-divider" />

            <div className="incoming-package-header">
              <h2>Incoming Package</h2>
              <span className="incoming-summary-pill">{files.length} files · {formatSize(totalSize)}</span>
            </div>

            <div className="incoming-file-list" role="list" aria-label="Incoming files">
              {files.map((file) => (
                <div className="incoming-file-row" key={file.id} role="listitem">
                  <span className={`file-type-badge ${file.extension}`}><FileTypeIcon extension={file.extension} /></span>
                  <div className="file-meta">
                    <span className="file-name">{file.name}</span>
                    <span className="file-size">{formatSize(file.size)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="incoming-actions">
              <button type="button" className="decline-button" onClick={onDecline}>Decline</button>
              <button type="button" className="accept-button" onClick={onAccept}>Accept Transfer</button>
            </div>
          </article>
        </div>
      </section>
    </main>
  )
}

function DownloadingTransfer({ onHome, incomingTransfer, progress }) {
  return (
    <main className="approval-screen">
      <Header onHome={onHome} />
      <section className="approval-content" aria-labelledby="download-title">
        <div className="approval-status-block">
          <div className="radar-graphic radar-blue" aria-hidden="true">
            <span className="radar-ring outer" />
            <span className="radar-ring middle" />
            <span className="radar-ring inner" />
            <span className="radar-center-icon blue"><DownloadIcon /></span>
          </div>
          <div className="receive-copy">
            <h1 id="download-title">Receiving Files</h1>
            <p>Your incoming transfer is being downloaded securely.</p>
          </div>
          <div className="payload-pill"><span>Downloading {incomingTransfer?.files?.length || 0} files · {Math.round(progress)}%</span></div>
        </div>
      </section>
    </main>
  )
}

function CheckIcon() {
  return (
    <svg className="check-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  )
}

function TransferComplete({ onHome, incomingTransfer, selectedFiles, peerName }) {
  const [showDetails, setShowDetails] = useState(false)
  const files = incomingTransfer?.files || selectedFiles
  const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0)

  return (
    <main className="complete-screen">
      <Header onHome={onHome} />
      <section className="complete-content" aria-labelledby="complete-title">
        <div className="complete-summary">
          <div className="success-badge"><CheckIcon /></div>
          <div className="complete-copy">
            <h1 id="complete-title">Transfer Complete</h1>
            <p>Your academic files were safely and successfully compiled and transmitted to the recipient.</p>
          </div>

          <div className="metadata-card">
            <div className="metadata-row"><span>{incomingTransfer ? 'FROM' : 'TO'}</span><strong>{peerName || 'Nearby device'}</strong></div>
            <div className="metadata-divider" />
            <div className="metadata-row"><span>PACKAGE SIZE</span><strong>{formatSize(totalSize)} ({files.length} Files)</strong></div>
            <div className="metadata-divider" />
            <div className="metadata-row"><span>COMPLETED AT</span><strong>{incomingTransfer?.completedAt ? new Date(incomingTransfer.completedAt).toLocaleString() : 'Just completed'}</strong></div>
          </div>

          {showDetails && (
            <div className="delivery-details" aria-label="Transfer delivery details">
              {incomingTransfer && <div className="delivery-row"><span>{incomingTransfer.fileName}</span><strong>Delivered</strong></div>}
            </div>
          )}

          <div className="complete-actions">
            <button type="button" className="details-button" onClick={() => setShowDetails((visible) => !visible)}>{showDetails ? 'Hide Details' : 'View Transfer Details'}</button>
            <button type="button" className="done-button" onClick={onHome}>Done</button>
          </div>
        </div>
      </section>
    </main>
  )
}

function ReadyToReceive({ onHome, onIncoming, toast, localDevice, hasIncomingTransfer }) {
  return (
    <main className="receive-ready-screen">
      <Header onHome={onHome} />
      <section className="receive-ready-content">
        <div className="receive-ready-block">
          <div className="radar-graphic radar-blue" aria-hidden="true">
            <span className="radar-ring outer" />
            <span className="radar-ring middle" />
            <span className="radar-ring inner" />
            <span className="radar-center-icon blue">
              <ShareIcon />
            </span>
          </div>

          <div className="receive-copy">
            <h1>Ready to Receive</h1>
            <p>Your device is now visible for nearby file transfers.</p>
          </div>

          <div className="device-info-card">
            <div className="device-card-left">
              <span className="device-card-icon"><LaptopIcon /></span>
              <div className="device-card-text">
                <span className="device-card-label">MY CURRENT DEVICE</span>
                <strong>{localDevice.name}</strong>
              </div>
            </div>
            <span className="visible-pill">• Visible</span>
          </div>

          <button type="button" className="incoming-preview-btn" onClick={onIncoming} disabled={!hasIncomingTransfer}>View Incoming Request</button>
          <button type="button" className="stop-receiving-btn" onClick={onHome}>Stop Receiving</button>
        </div>
      </section>
      {toast && <div className="transfer-toast" role="status">{toast}</div>}
    </main>
  )
}

function App() {
  const [screen, setScreen] = useState('home')
  const [toast, setToast] = useState('')
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [selectedFiles, setSelectedFiles] = useState([
    
  ])
  const transfer = useFileTransfer()

  const { incomingTransfer, transferStatus, sendFile, connectToDevice, cancelTransfer, acceptIncomingTransfer, declineIncomingTransfer } = transfer

  useEffect(() => {
    if (incomingTransfer && screen !== 'incoming' && transferStatus === 'waiting-for-acceptance') {
      window.setTimeout(() => setScreen('incoming'), 0)
    }
    if (screen === 'downloading' && transferStatus === 'completed') {
      window.setTimeout(() => setScreen('complete'), 0)
    }
    if (screen === 'waiting' && transferStatus === 'completed') {
      window.setTimeout(() => setScreen('complete'), 0)
    }
  }, [incomingTransfer, screen, transferStatus])

  useEffect(() => {
    if (screen !== 'waiting' || transferStatus !== 'sending' || !selectedFiles.length) return
    sendFile(selectedFiles.map((file) => file.nativeFile).filter(Boolean))
  }, [screen, selectedFiles, sendFile, transferStatus])

  useEffect(() => {
    function handleSenderCancellation(event) {
      if (screen !== 'incoming') return
      setScreen('receive-ready')
      setToast(`Transfer request was canceled by ${event.detail?.sender || 'the sender'}.`)
    }

    window.addEventListener('transfer-canceled', handleSenderCancellation)
    return () => window.removeEventListener('transfer-canceled', handleSenderCancellation)
  }, [screen])

  useEffect(() => {
    if (!toast) return undefined
    const timeoutId = window.setTimeout(() => setToast(''), 4000)
    return () => window.clearTimeout(timeoutId)
  }, [toast])

  if (screen === 'nearby') {
    return <NearbyDevices onlineDevices={transfer.onlineDevices} isScanning={transfer.isScanning} refreshDevices={transfer.refreshDevices} onBack={() => setScreen('home')} onSelectDevice={(device) => { setSelectedDevice(device); transfer.setSelectedDevice(device); setScreen('file-selection') }} />
  }

  if (screen === 'file-selection') {
    return <FileSelection onHome={() => setScreen('home')} onContinue={() => setScreen('review')} selectedFiles={selectedFiles} setSelectedFiles={setSelectedFiles} />
  }

  if (screen === 'review') {
    return <ReviewTransferDetails selectedDevice={selectedDevice} selectedFiles={selectedFiles} onHome={() => setScreen('home')} onBack={() => setScreen('file-selection')} onSend={() => { if (transfer.onlineDevices.some((device) => device.deviceId === selectedDevice?.deviceId)) { connectToDevice(selectedDevice, selectedFiles.map((file) => file.nativeFile).filter(Boolean)); setScreen('waiting') } else setScreen('nearby') }} />
  }

  if (screen === 'waiting') {
    return <WaitingForApproval selectedDevice={selectedDevice} selectedFiles={selectedFiles} status={transferStatus} progress={transfer.sendProgress} error={transfer.error} onHome={() => setScreen('home')} onCancel={() => { cancelTransfer(); setScreen('review') }} />
  }

  if (screen === 'incoming') {
    return <IncomingFileTransfer incomingTransfer={incomingTransfer} onDecline={() => { declineIncomingTransfer(); setScreen('receive-ready') }} onAccept={() => { acceptIncomingTransfer(); setScreen('downloading') }} />
  }

  if (screen === 'downloading') {
    return <DownloadingTransfer incomingTransfer={incomingTransfer} progress={transfer.receiveProgress} onHome={() => setScreen('home')} />
  }

  if (screen === 'complete') {
    return <TransferComplete incomingTransfer={incomingTransfer} selectedFiles={selectedFiles} peerName={incomingTransfer?.senderName || selectedDevice?.name} onHome={() => setScreen('home')} />
  }

  if (screen === 'recent') {
    return <RecentTransfers transferHistory={transfer.transferHistory} onHome={() => setScreen('home')} />
  }

  if (screen === 'receive-ready') {
    return <ReadyToReceive localDevice={transfer.localDevice} hasIncomingTransfer={Boolean(incomingTransfer)} onHome={() => setScreen('home')} onIncoming={() => { if (incomingTransfer) { setToast(''); setScreen('incoming') } }} toast={toast} />
  }

  return (
    <main id="home">
      <Header onHome={() => setScreen('home')} onRecentTransfers={() => setScreen('recent')} />
      <section className="home-content" aria-labelledby="home-title">
        <h1 id="home-title">What would you like to do?</h1>
        <p className="intro">Share course materials, assignments, and slides instantly with nearby Dominion University peers and faculty.</p>
        <div className="transfer-cards">
          <TransferCard featured title="Send Files" description="Select files from your device and transfer them to a nearby peer or professor." action="Get Started" icon={<UploadIcon />} onAction={() => setScreen('nearby')} />
          <TransferCard title="Receive Files" description="Make this device visible to receive incoming slides, sheets, and documents." action="Open Portal" icon={<DownloadIcon />} onAction={() => setScreen('receive-ready')} />
        </div>
        <p className="connection-status"><span aria-hidden="true" /> {transfer.connectionStatus === 'connected' ? 'Connected to nearby devices' : transfer.connectionStatus === 'connecting' ? 'Connecting to nearby devices' : 'Signaling connection unavailable'}</p>
      </section>
    </main>
  )
}

export default App
