import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const CHUNK_SIZE = 65536
const MAX_BUFFERED_AMOUNT = 1024 * 1024
const DEVICE_KEY = 'nacosdu-share-device-id'
const HISTORY_KEY = 'nacosdu-share-transfer-history'
const NETWORK_ID = import.meta.env.VITE_NETWORK_ID || 'nacosdu-share-local'
const SIGNALING_SERVER_URL =
  import.meta.env.VITE_SIGNALING_SERVER_URL || 'http://localhost:4000'

const APPROVAL_TIMEOUT = 45000
const CONFIRMATION_TIMEOUT = 60000
const CONNECTION_TIMEOUT = 30000
const URL_REVOKE_DELAY = 30000

const ACTIVE = new Set([
  'waiting-for-acceptance', 'connecting', 'sending',
  'receiving', 'waiting-for-receiver-confirmation'
])

const TRANSITIONS = {
  idle: ['waiting-for-acceptance', 'receiving', 'error'],
  'waiting-for-acceptance': ['connecting', 'declined', 'cancelled', 'error'],
  connecting: ['sending', 'receiving', 'cancelled', 'error', 'disconnected'],
  sending: ['waiting-for-receiver-confirmation', 'cancelled', 'error', 'disconnected'],
  receiving: ['completed', 'cancelled', 'error', 'disconnected'],
  'waiting-for-receiver-confirmation': ['completed', 'cancelled', 'error', 'disconnected'],
  completed: ['idle'],
  declined: ['idle'],
  cancelled: ['idle'],
  error: ['idle'],
  disconnected: ['idle', 'error']
}

function validUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const SAFE_SIGNALING_URL = validUrl(SIGNALING_SERVER_URL)
  ? SIGNALING_SERVER_URL
  : 'http://localhost:4000'

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

function getDeviceType() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 700)
  return mobile ? 'smartphone' : window.innerWidth >= 1600 ? 'monitor' : 'laptop'
}

function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function makeManifest(files) {
  return files.map(file => ({
    name: file.name || 'file',
    size: Number(file.size) || 0,
    type: file.type || 'application/octet-stream',
    totalChunks: Math.ceil((Number(file.size) || 0) / CHUNK_SIZE)
  }))
}

function resetReceiveState() {
  return {
    metadata: null,
    files: [],
    activeFileIndex: -1,
    receivedBytes: 0,
    expectedBytes: 0,
    receivedChunks: 0,
    completedFiles: new Set(),
    unexpectedData: false
  }
}

function waitForBufferedAmountLow(channel) {
  return new Promise((resolve, reject) => {
    if (channel.readyState !== 'open') {
      reject(new Error('DataChannel is not open'))
      return
    }
    if (channel.bufferedAmount <= MAX_BUFFERED_AMOUNT) {
      resolve()
      return
    }

    let settled = false
    const cleanup = () => {
      channel.removeEventListener('bufferedamountlow', onLow)
      channel.removeEventListener('close', onClose)
      channel.removeEventListener('error', onError)
      clearTimeout(timer)
    }
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }
    const onLow = () => finish(resolve)
    const onClose = () => finish(reject, new Error('DataChannel closed during backpressure wait'))
    const onError = () => finish(reject, new Error('DataChannel error during backpressure wait'))
    const timer = setTimeout(() => {
      finish(reject, new Error('Backpressure wait timed out'))
    }, 30000)

    channel.addEventListener('bufferedamountlow', onLow)
    channel.addEventListener('close', onClose)
    channel.addEventListener('error', onError)

    if (channel.bufferedAmount <= MAX_BUFFERED_AMOUNT) finish(resolve)
  })
}

export default function useFileTransfer() {
  const socketRef = useRef(null)
  const peerConnectionRef = useRef(null)
  const dataChannelRef = useRef(null)
  const pendingIceRef = useRef([])
  const seenIceRef = useRef(new Set())
  const transferRef = useRef(null)
  const receiveRef = useRef(resetReceiveState())
  const pendingFilesRef = useRef([])
  const approvalTimerRef = useRef(null)
  const confirmationTimerRef = useRef(null)
  const connectionTimerRef = useRef(null)
  const disconnectTimerRef = useRef(null)
  const cleanupInProgressRef = useRef(false)
  const unmountedRef = useRef(false)
  const deviceIdRef = useRef(getDeviceId())
  const localDeviceRef = useRef(null)
  const transferStatusRef = useRef('idle')

  const [onlineDevices, setOnlineDevices] = useState([])
  const [isScanning, setIsScanning] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [incomingTransfer, setIncomingTransfer] = useState(null)
  const [transferStatus, setTransferStatus] = useState('idle')
  const [sendProgress, setSendProgress] = useState(0)
  const [receiveProgress, setReceiveProgress] = useState(0)
  const [error, setError] = useState('')
  const [transferHistory, setTransferHistory] = useState(readHistory)
  const [localDevice, setLocalDevice] = useState(() => {
    const id = deviceIdRef.current
    const type = getDeviceType()
    return {
      deviceId: id,
      name: `${type[0].toUpperCase()}${type.slice(1)} · ${id.slice(0, 6)}`,
      type,
      status: 'Ready to receive'
    }
  })

  useEffect(() => {
    localDeviceRef.current = localDevice
  }, [localDevice])

  const setTransfer = useCallback((next, { force = false } = {}) => {
    const current = transferStatusRef.current
    if (!force && current !== next && !(TRANSITIONS[current] || []).includes(next)) {
      console.warn(`[Transfer] Invalid transition ${current} -> ${next}`)
      return false
    }
    transferStatusRef.current = next
    if (!unmountedRef.current) setTransferStatus(next)
    return true
  }, [])

  const clearTimers = useCallback((transferId) => {
    const active = transferRef.current
    if (transferId && active && active.transferId !== transferId) return
    for (const ref of [approvalTimerRef, confirmationTimerRef, connectionTimerRef, disconnectTimerRef]) {
      if (ref.current) {
        clearTimeout(ref.current)
        ref.current = null
      }
    }
  }, [])

  const recordTransfer = useCallback((record) => {
    if (record.status !== 'Completed' || !record.transferId) return
    const existing = readHistory()
    if (existing.some(item => item.transferId === record.transferId && item.direction === record.direction)) return
    const next = [{ ...record, id: record.transferId, timestamp: record.timestamp || new Date().toISOString() }, ...existing].slice(0, 50)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
    setTransferHistory(next)
  }, [])

  const cleanupConnection = useCallback((options = {}) => {
    const { transferId, preserveStatus = false, intentional = true, keepTransfer = false } = options
    const active = transferRef.current
    if (transferId && active?.transferId !== transferId) return
    if (cleanupInProgressRef.current) return
    cleanupInProgressRef.current = true

    clearTimers(transferId)
    if (active) active.intentionalClose = intentional

    const channel = dataChannelRef.current
    if (channel) {
      channel.onopen = null
      channel.onmessage = null
      channel.onerror = null
      channel.onclose = null
      try { if (channel.readyState !== 'closed') channel.close() } catch {}
    }
    dataChannelRef.current = null

    const peer = peerConnectionRef.current
    if (peer) {
      peer.onicecandidate = null
      peer.onconnectionstatechange = null
      peer.oniceconnectionstatechange = null
      peer.ondatachannel = null
      try { peer.close() } catch {}
    }
    peerConnectionRef.current = null

    pendingIceRef.current = []
    seenIceRef.current.clear()
    receiveRef.current = resetReceiveState()
    pendingFilesRef.current = []
    if (!keepTransfer) transferRef.current = null
    if (!preserveStatus && !ACTIVE.has(transferStatusRef.current)) {
      // terminal state is intentionally preserved for the UI
    }
    cleanupInProgressRef.current = false
  }, [clearTimers])

  const failTransfer = useCallback((message, transferId) => {
    if (transferId && transferRef.current?.transferId !== transferId) return
    console.error('[Transfer]', message)
    setError(message)
    if (transferStatusRef.current !== 'cancelled' && transferStatusRef.current !== 'declined') {
      setTransfer('error', { force: true })
    }
    cleanupConnection({ transferId, preserveStatus: true, intentional: true })
  }, [cleanupConnection, setTransfer])

  const isCurrentTransfer = useCallback((transferId) =>
    Boolean(transferId && transferRef.current?.transferId === transferId), [])

  const sendControl = useCallback((message) => {
    const channel = dataChannelRef.current
    if (!channel || channel.readyState !== 'open') return false
    channel.send(JSON.stringify(message))
    return true
  }, [])

  const releaseReceiveBuffers = useCallback(() => {
    receiveRef.current.files.forEach(file => { file.buffers.length = 0 })
    receiveRef.current = resetReceiveState()
  }, [])

  const handleControlRef = useRef(null)

  const attachChannel = useCallback((channel) => {
    const transferId = transferRef.current?.transferId
    dataChannelRef.current = channel
    channel.binaryType = 'arraybuffer'
    channel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT / 2

    channel.onopen = () => {
      if (!isCurrentTransfer(transferId)) return
      const role = transferRef.current?.role
      setTransfer(role === 'sender' ? 'sending' : 'receiving', { force: true })
      if (role === 'sender' && pendingFilesRef.current.length && !transferRef.current.sendingStarted) {
        transferRef.current.sendingStarted = true
        queueMicrotask(() => sendFileInternal(pendingFilesRef.current))
      }
    }

    channel.onmessage = event => {
      if (!isCurrentTransfer(transferId)) return
      if (typeof event.data === 'string') {
        try { handleControlRef.current?.(JSON.parse(event.data), channel) }
        catch { failTransfer('Received an invalid transfer message.', transferId) }
        return
      }

      if (!(event.data instanceof ArrayBuffer)) {
        receiveRef.current.unexpectedData = true
        failTransfer('Received unexpected transfer data.', transferId)
        return
      }

      const current = receiveRef.current
      const index = current.activeFileIndex
      const metadata = current.metadata?.files?.[index]
      const file = current.files?.[index]
      if (!metadata || !file || current.completedFiles.has(index)) {
        current.unexpectedData = true
        failTransfer('Transfer incomplete: received data without an active file.', transferId)
        return
      }

      const expectedChunk = metadata.totalChunks
      if (file.count >= expectedChunk || current.receivedBytes + event.data.byteLength > current.expectedBytes) {
        current.unexpectedData = true
        failTransfer('Transfer incomplete: unexpected extra file data was received.', transferId)
        return
      }

      file.buffers.push(event.data)
      file.count += 1
      file.bytes += event.data.byteLength
      current.receivedBytes += event.data.byteLength
      current.receivedChunks += 1
      setReceiveProgress(current.expectedBytes ? Math.min(100, current.receivedBytes / current.expectedBytes * 100) : 0)
    }

    channel.onerror = () => {
      if (isCurrentTransfer(transferId) && !transferRef.current?.intentionalClose) {
        failTransfer('The file transfer connection failed.', transferId)
      }
    }

    channel.onclose = () => {
      if (!isCurrentTransfer(transferId) || transferRef.current?.intentionalClose) return
      const status = transferStatusRef.current
      if (['completed', 'cancelled', 'declined', 'error'].includes(status)) return
      setTransfer('disconnected', { force: true })
      failTransfer('The file transfer connection was interrupted.', transferId)
    }
  }, [failTransfer, isCurrentTransfer, setTransfer])

  const flushPendingIce = useCallback(async (peer, transferId) => {
    const pending = pendingIceRef.current
    pendingIceRef.current = []
    for (const item of pending) {
      if (item.transferId !== transferId || !isCurrentTransfer(transferId)) continue
      try { await peer.addIceCandidate(new RTCIceCandidate(item.candidate)) }
      catch (err) { console.warn('[ICE] Ignoring candidate add error', err) }
    }
  }, [isCurrentTransfer])

  const createPeer = useCallback((remoteDeviceId, initiator, transferId) => {
    if (!isCurrentTransfer(transferId)) throw new Error('Stale transfer')
    if (peerConnectionRef.current) return peerConnectionRef.current

    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })
    peerConnectionRef.current = peer

    peer.onicecandidate = ({ candidate }) => {
      if (!candidate || !isCurrentTransfer(transferId)) return
      socketRef.current?.emit('ice-candidate', {
        networkId: NETWORK_ID,
        fromDeviceId: deviceIdRef.current,
        toDeviceId: remoteDeviceId,
        transferId,
        candidate
      })
    }

    peer.onconnectionstatechange = () => {
      if (!isCurrentTransfer(transferId)) return
      if (peer.connectionState === 'failed') failTransfer('Unable to connect to the selected device.', transferId)
      if (peer.connectionState === 'disconnected') {
        if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current)
        disconnectTimerRef.current = setTimeout(() => {
          if (isCurrentTransfer(transferId) && peer.connectionState === 'disconnected') {
            failTransfer('The file transfer connection was interrupted.', transferId)
          }
        }, 8000)
      }
      if (peer.connectionState === 'connected' && disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current)
        disconnectTimerRef.current = null
      }
    }

    peer.ondatachannel = ({ channel }) => {
      if (isCurrentTransfer(transferId)) attachChannel(channel)
    }

    if (initiator) attachChannel(peer.createDataChannel('file-transfer-channel', { ordered: true }))
    return peer
  }, [attachChannel, failTransfer, isCurrentTransfer])

  const finalizeReceivedTransfer = useCallback((channel, transferId) => {
    const current = receiveRef.current
    const metadata = current.metadata
    if (!metadata || !isCurrentTransfer(transferId)) return

    const reject = message => {
      sendControl({ type: 'transfer-received', transferId, success: false, error: message })
      setError(message)
      setTransfer('error', { force: true })
      releaseReceiveBuffers()
      cleanupConnection({ transferId, preserveStatus: true, intentional: true })
    }

    if (current.unexpectedData || current.receivedBytes !== current.expectedBytes) {
      reject('Transfer incomplete: received data does not match the expected file size.')
      return
    }
    if (current.completedFiles.size !== metadata.files.length ||
        current.files.some((file, index) => file.count !== metadata.files[index].totalChunks)) {
      reject('Transfer incomplete: one or more file chunks are missing.')
      return
    }

    try {
      const completed = metadata.files.map((fileMeta, index) => {
        const file = current.files[index]
        if (file.bytes !== fileMeta.size) throw new Error(`File size mismatch for ${fileMeta.name}`)
        const blob = new Blob(file.buffers, { type: fileMeta.type })
        if (blob.size !== fileMeta.size) throw new Error(`Blob size mismatch for ${fileMeta.name}`)
        return { ...fileMeta, blob }
      })

      completed.forEach(({ name, blob }) => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = name
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), URL_REVOKE_DELAY)
      })

      sendControl({ type: 'transfer-received', transferId, success: true, receivedBytes: current.receivedBytes,
        fileName: metadata.files.map(file => file.name).join(', ') })

      const timestamp = new Date().toISOString()
      setReceiveProgress(100)
      setTransfer('completed', { force: true })
      recordTransfer({
        transferId, direction: 'received', fileName: metadata.files.map(file => file.name).join(', '),
        files: metadata.files, fileSize: current.expectedBytes,
        peerDeviceName: metadata.senderName || metadata.remoteDeviceName,
        peerDeviceId: metadata.senderDeviceId || metadata.remoteDeviceId,
        status: 'Completed', timestamp
      })
      releaseReceiveBuffers()
    } catch (err) {
      reject(`Transfer failed: ${err.message}`)
    }
  }, [cleanupConnection, isCurrentTransfer, recordTransfer, releaseReceiveBuffers, sendControl, setTransfer])

  handleControlRef.current = (message, channel) => {
    const transferId = message?.transferId
    if (!isCurrentTransfer(transferId)) return
    const current = receiveRef.current

    if (message.type === 'transfer-cancelled') {
      setTransfer('cancelled', { force: true })
      cleanupConnection({ transferId, preserveStatus: true, intentional: true })
      return
    }

    if (message.type === 'file-metadata') {
      if (transferRef.current?.role !== 'receiver' || !Array.isArray(message.files) || !message.files.length) {
        failTransfer('Received invalid file metadata.', transferId)
        return
      }
      const expectedBytes = message.files.reduce((sum, file) => sum + Number(file.size || 0), 0)
      current.metadata = {
        ...transferRef.current,
        files: message.files,
        totalChunks: Number(message.totalChunks || 0),
        totalBytes: expectedBytes
      }
      current.expectedBytes = expectedBytes
      current.files = message.files.map(() => ({ buffers: [], count: 0, bytes: 0 }))
      current.activeFileIndex = -1
      return
    }

    if (message.type === 'file-start') {
      const index = Number(message.index)
      if (!current.metadata || !Number.isInteger(index) || index < 0 || index >= current.files.length ||
          current.completedFiles.has(index) || index !== current.completedFiles.size) {
        failTransfer('Transfer protocol error: invalid file order.', transferId)
        return
      }
      current.activeFileIndex = index
      return
    }

    if (message.type === 'file-complete') {
      const index = Number(message.index)
      const file = current.files[index]
      const meta = current.metadata?.files[index]
      if (index !== current.activeFileIndex || !file || !meta ||
          file.count !== meta.totalChunks || file.bytes !== meta.size) {
        failTransfer('Transfer incomplete: file data validation failed.', transferId)
        return
      }
      current.completedFiles.add(index)
      current.activeFileIndex = -1
      return
    }

    if (message.type === 'transfer-complete') {
      if (current.activeFileIndex !== -1) {
        failTransfer('Transfer protocol error: transfer ended before a file completed.', transferId)
        return
      }
      finalizeReceivedTransfer(channel, transferId)
      return
    }

    if (message.type === 'transfer-received' && transferRef.current?.role === 'sender') {
      if (confirmationTimerRef.current) {
        clearTimeout(confirmationTimerRef.current)
        confirmationTimerRef.current = null
      }
      if (!message.success) {
        failTransfer(message.error || 'The receiver could not validate the transferred files.', transferId)
        return
      }
      const active = transferRef.current
      setSendProgress(100)
      setTransfer('completed', { force: true })
      recordTransfer({
        transferId, direction: 'sent',
        fileName: active.files?.map(file => file.name).join(', ') || message.fileName || '',
        files: active.files || [], fileSize: active.totalBytes || message.receivedBytes || 0,
        peerDeviceName: active.remoteDeviceName, peerDeviceId: active.remoteDeviceId,
        status: 'Completed'
      })
    }
  }

  const sendFileInternal = async files => {
    const active = transferRef.current
    const channel = dataChannelRef.current
    if (!active || active.role !== 'sender' || !channel || channel.readyState !== 'open') {
      throw new Error('DataChannel is not ready')
    }

    const validFiles = (Array.isArray(files) ? files : [files]).filter(file =>
      file && typeof file.slice === 'function' && Number.isFinite(file.size)
    )
    if (!validFiles.length) throw new Error('No valid files to send')

    const manifest = makeManifest(validFiles)
    const totalBytes = manifest.reduce((sum, file) => sum + file.size, 0)
    const totalChunks = manifest.reduce((sum, file) => sum + file.totalChunks, 0)
    active.files = manifest
    active.totalBytes = totalBytes
    pendingFilesRef.current = validFiles
    setTransfer('sending', { force: true })
    setSendProgress(0)

    channel.send(JSON.stringify({ type: 'file-metadata', transferId: active.transferId, files: manifest, totalBytes, totalChunks }))
    let sentBytes = 0

    for (let fileIndex = 0; fileIndex < validFiles.length; fileIndex++) {
      const file = validFiles[fileIndex]
      const meta = manifest[fileIndex]
      if (!isCurrentTransfer(active.transferId) || active.cancelled) throw new Error('Transfer cancelled')

      channel.send(JSON.stringify({ type: 'file-start', transferId: active.transferId, index: fileIndex }))
      for (let chunkIndex = 0; chunkIndex < meta.totalChunks; chunkIndex++) {
        if (!isCurrentTransfer(active.transferId) || active.cancelled) throw new Error('Transfer cancelled')
        if (channel.readyState !== 'open') throw new Error('DataChannel closed during file transmission')
        while (channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
          await waitForBufferedAmountLow(channel)
          if (!isCurrentTransfer(active.transferId) || active.cancelled) throw new Error('Transfer cancelled')
          if (channel.readyState !== 'open') throw new Error('DataChannel closed during file transmission')
        }

        const start = chunkIndex * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, file.size)
        const buffer = await file.slice(start, end).arrayBuffer()
        if (channel.readyState !== 'open') throw new Error('DataChannel closed during file transmission')
        channel.send(buffer)
        sentBytes += buffer.byteLength
        setSendProgress(totalBytes ? Math.min(100, sentBytes / totalBytes * 100) : 100)
      }
      channel.send(JSON.stringify({ type: 'file-complete', transferId: active.transferId, index: fileIndex }))
    }

    if (!isCurrentTransfer(active.transferId) || active.cancelled) throw new Error('Transfer cancelled')
    channel.send(JSON.stringify({ type: 'transfer-complete', transferId: active.transferId }))
    setSendProgress(100)
    setTransfer('waiting-for-receiver-confirmation', { force: true })

    confirmationTimerRef.current = setTimeout(() => {
      if (isCurrentTransfer(active.transferId) &&
          transferStatusRef.current === 'waiting-for-receiver-confirmation') {
        failTransfer('Receiver did not confirm file transfer.', active.transferId)
      }
    }, CONFIRMATION_TIMEOUT)
  }

  const refreshDevices = useCallback(() => {
    setIsScanning(true)
    if (!socketRef.current?.connected) {
      setIsScanning(false)
      setError('Signaling server is unavailable.')
      return
    }
    socketRef.current.emit('refresh-devices', { networkId: NETWORK_ID })
  }, [])

  const connectToDevice = useCallback((device, files) => {
    if (!device || !socketRef.current?.connected) {
      setError('Signaling server is unavailable.')
      return
    }
    if (ACTIVE.has(transferStatusRef.current)) {
      setError('A transfer is already in progress.')
      return
    }

    const input = Array.isArray(files) ? files : [files]
    const validFiles = input.filter(file => file && typeof file.slice === 'function' && Number.isFinite(file.size))
    if (!validFiles.length) {
      setError('No valid files to transfer.')
      return
    }

    cleanupConnection({ preserveStatus: true, intentional: true })
    const transferId = crypto.randomUUID()
    const manifest = makeManifest(validFiles)
    const totalBytes = manifest.reduce((sum, file) => sum + file.size, 0)

    transferRef.current = {
      transferId, role: 'sender', remoteDeviceId: device.deviceId, remoteDeviceName: device.name,
      files: manifest, totalBytes, cancelled: false, intentionalClose: false, sendingStarted: false
    }
    pendingFilesRef.current = validFiles
    setSelectedDevice(device)
    setSendProgress(0)
    setError('')
    setTransfer('waiting-for-acceptance', { force: true })

    socketRef.current.emit('transfer-request', {
      networkId: NETWORK_ID, targetDeviceId: device.deviceId, transferId, files: manifest,
      totalChunks: manifest.reduce((sum, file) => sum + file.totalChunks, 0),
      totalBytes,
      senderDevice: { deviceId: deviceIdRef.current, name: localDeviceRef.current?.name, type: localDeviceRef.current?.type }
    })

    approvalTimerRef.current = setTimeout(() => {
      if (isCurrentTransfer(transferId) && transferStatusRef.current === 'waiting-for-acceptance') {
        failTransfer('The transfer request timed out.', transferId)
      }
    }, APPROVAL_TIMEOUT)
  }, [cleanupConnection, failTransfer, isCurrentTransfer, setTransfer])

  const sendFile = useCallback(async files => {
    try {
      await sendFileInternal(files || pendingFilesRef.current)
    } catch (err) {
      const transferId = transferRef.current?.transferId
      if (err.message === 'Transfer cancelled') return
      failTransfer(`File transmission failed: ${err.message}`, transferId)
    }
  }, [failTransfer])

  const acceptIncomingTransfer = useCallback(() => {
    const active = transferRef.current
    if (!active || active.role !== 'receiver' || !socketRef.current?.connected ||
        transferStatusRef.current !== 'waiting-for-acceptance') return

    setIncomingTransfer(null)
    setTransfer('connecting', { force: true })
    socketRef.current.emit('transfer-response', {
      networkId: NETWORK_ID, transferId: active.transferId,
      senderDeviceId: active.remoteDeviceId, accepted: true
    })
    connectionTimerRef.current = setTimeout(() => {
      if (isCurrentTransfer(active.transferId) && !dataChannelRef.current) {
        failTransfer('Unable to connect to the selected device.', active.transferId)
      }
    }, CONNECTION_TIMEOUT)
  }, [failTransfer, isCurrentTransfer, setTransfer])

  const declineIncomingTransfer = useCallback(() => {
    const active = transferRef.current
    if (!active || active.role !== 'receiver') return
    socketRef.current?.emit('transfer-response', {
      networkId: NETWORK_ID, transferId: active.transferId,
      senderDeviceId: active.remoteDeviceId, accepted: false,
      reason: 'The recipient declined the transfer.'
    })
    setIncomingTransfer(null)
    setTransfer('declined', { force: true })
    cleanupConnection({ transferId: active.transferId, preserveStatus: true, intentional: true })
  }, [cleanupConnection, setTransfer])

  const cancelTransfer = useCallback(() => {
    const active = transferRef.current
    if (!active?.transferId) return
    active.cancelled = true
    const transferId = active.transferId
    const status = transferStatusRef.current

    if (dataChannelRef.current?.readyState === 'open') {
      sendControl({ type: 'transfer-cancelled', transferId })
    } else if (socketRef.current?.connected) {
      socketRef.current.emit('transfer-cancel', {
        networkId: NETWORK_ID, targetDeviceId: active.remoteDeviceId, transferId
      })
    }

    setIncomingTransfer(null)
    setTransfer('cancelled', { force: true })
    cleanupConnection({ transferId, preserveStatus: true, intentional: true })
  }, [cleanupConnection, sendControl, setTransfer])

  useEffect(() => {
    unmountedRef.current = false
    const socket = io(SAFE_SIGNALING_URL, {
      transports: ['websocket', 'polling'],
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    })
    socketRef.current = socket

    const joinNetwork = () => {
      const device = localDeviceRef.current
      if (!device) return
      socket.emit('join-network', {
        deviceId: deviceIdRef.current, deviceName: device.name, deviceType: device.type,
        networkId: NETWORK_ID, userAgent: navigator.userAgent
      })
    }

    const onConnect = () => {
      setConnectionStatus('connected')
      setError('')
      setLocalDevice(device => ({ ...device, socketId: socket.id }))
      joinNetwork()
      socket.emit('refresh-devices', { networkId: NETWORK_ID })
    }

    const onDisconnect = () => setConnectionStatus('disconnected')
    const onConnectError = () => {
      setConnectionStatus('error')
      setError('Signaling server is unavailable.')
    }

    const onDevices = devices => {
      const map = new Map()
      ;(Array.isArray(devices) ? devices : []).forEach(device => {
        if (device?.deviceId && device.deviceId !== deviceIdRef.current) map.set(device.deviceId, device)
      })
      setOnlineDevices([...map.values()])
      setIsScanning(false)
    }

    const onTransferRequest = request => {
      if (!request?.transferId || !request.senderDeviceId || !Array.isArray(request.files) || !request.files.length) return
      if (transferRef.current) return

      transferRef.current = {
        ...request, transferId: request.transferId, role: 'receiver',
        remoteDeviceId: request.senderDeviceId,
        remoteDeviceName: request.senderDevice?.name || request.senderName || 'Unknown device',
        senderDeviceId: request.senderDeviceId,
        senderName: request.senderDevice?.name || request.senderName || 'Unknown device',
        cancelled: false, intentionalClose: false
      }
      receiveRef.current = resetReceiveState()
      setReceiveProgress(0)
      setError('')
      setIncomingTransfer({
        ...request,
        senderName: request.senderDevice?.name || request.senderName || 'Unknown device',
        senderType: request.senderDevice?.type || 'unknown'
      })
      setTransfer('waiting-for-acceptance', { force: true })
    }

    const onTransferResponse = async ({ transferId, accepted, reason }) => {
      const active = transferRef.current
      if (!active || active.transferId !== transferId || active.role !== 'sender') return
      if (approvalTimerRef.current) { clearTimeout(approvalTimerRef.current); approvalTimerRef.current = null }

      if (!accepted) {
        setError(reason || 'The recipient declined the transfer.')
        setTransfer('declined', { force: true })
        cleanupConnection({ transferId, preserveStatus: true, intentional: true })
        return
      }

      try {
        setTransfer('connecting', { force: true })
        const peer = createPeer(active.remoteDeviceId, true, transferId)
        const offer = await peer.createOffer()
        if (!isCurrentTransfer(transferId)) return
        await peer.setLocalDescription(offer)
        socket.emit('signal-offer', {
          networkId: NETWORK_ID, fromDeviceId: deviceIdRef.current,
          toDeviceId: active.remoteDeviceId, transferId, offer: peer.localDescription
        })
      } catch {
        failTransfer('WebRTC negotiation failed.', transferId)
      }
    }

    const onOffer = async ({ fromDeviceId, transferId, offer }) => {
      const active = transferRef.current
      if (!active || active.transferId !== transferId || active.role !== 'receiver' ||
          active.cancelled || peerConnectionRef.current) return
      try {
        const peer = createPeer(fromDeviceId, false, transferId)
        await peer.setRemoteDescription(new RTCSessionDescription(offer))
        await flushPendingIce(peer, transferId)
        if (!isCurrentTransfer(transferId)) return
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        socket.emit('signal-answer', {
          networkId: NETWORK_ID, fromDeviceId: deviceIdRef.current,
          toDeviceId: fromDeviceId, transferId, answer: peer.localDescription
        })
      } catch {
        failTransfer('WebRTC negotiation failed.', transferId)
      }
    }

    const onAnswer = async ({ transferId, answer }) => {
      const active = transferRef.current
      const peer = peerConnectionRef.current
      if (!active || active.transferId !== transferId || active.role !== 'sender' || !peer) return
      try {
        if (peer.remoteDescription) return
        await peer.setRemoteDescription(new RTCSessionDescription(answer))
        await flushPendingIce(peer, transferId)
      } catch {
        failTransfer('WebRTC negotiation failed.', transferId)
      }
    }

    const onIce = async ({ transferId, candidate }) => {
      if (!candidate || !isCurrentTransfer(transferId)) return
      const key = `${transferId}:${candidate.candidate || ''}:${candidate.sdpMid || ''}:${candidate.sdpMLineIndex || ''}`
      if (seenIceRef.current.has(key)) return
      seenIceRef.current.add(key)

      const peer = peerConnectionRef.current
      if (!peer || !peer.remoteDescription) {
        pendingIceRef.current.push({ transferId, candidate })
        return
      }
      try { await peer.addIceCandidate(new RTCIceCandidate(candidate)) }
      catch (err) { console.warn('[ICE] Candidate rejected', err) }
    }

    const onCancelled = ({ transferId }) => {
      if (!isCurrentTransfer(transferId)) return
      setIncomingTransfer(null)
      setTransfer('cancelled', { force: true })
      cleanupConnection({ transferId, preserveStatus: true, intentional: true })
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    socket.on('online-devices-updated', onDevices)
    socket.on('incoming-transfer-request', onTransferRequest)
    socket.on('transfer-response', onTransferResponse)
    socket.on('incoming-transfer-cancelled', onCancelled)
    socket.on('signal-offer', onOffer)
    socket.on('signal-answer', onAnswer)
    socket.on('ice-candidate', onIce)

    return () => {
      unmountedRef.current = true
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.off('online-devices-updated', onDevices)
      socket.off('incoming-transfer-request', onTransferRequest)
      socket.off('transfer-response', onTransferResponse)
      socket.off('incoming-transfer-cancelled', onCancelled)
      socket.off('signal-offer', onOffer)
      socket.off('signal-answer', onAnswer)
      socket.disconnect()
      if (socketRef.current === socket) socketRef.current = null
      cleanupConnection({ preserveStatus: true, intentional: true })
    }
  }, [cleanupConnection, createPeer, failTransfer, flushPendingIce, isCurrentTransfer, setTransfer])

  return {
    onlineDevices,
    isScanning,
    connectionStatus,
    selectedDevice,
    setSelectedDevice,
    localDevice: {
      ...localDevice,
      networkId: NETWORK_ID,
      isConnected: connectionStatus === 'connected',
      status: connectionStatus === 'connected' ? 'Ready to receive' : 'Offline'
    },
    incomingTransfer,
    transferStatus,
    sendProgress,
    receiveProgress,
    error,
    transferHistory,
    refreshDevices,
    connectToDevice,
    acceptIncomingTransfer,
    declineIncomingTransfer,
    sendFile,
    cancelTransfer,
    cleanupConnection
  }
}
