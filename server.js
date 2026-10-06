import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || '*', methods: ['GET', 'POST'] },
});
const networks = new Map();

app.get('/', (_request, response) => response.json({ status: 'ok', service: 'NACOSDU-SHARE signaling server' }));
app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'NACOSDU-SHARE signaling server' }));

function getNetwork(networkId) {
  if (!networks.has(networkId)) networks.set(networkId, new Map());
  return networks.get(networkId);
}

function publicDevices(network) {
  return [...network.values()].map((device) => ({
    deviceId: device.deviceId, socketId: device.socketId, name: device.name, type: device.type, status: device.status,
    networkId: device.networkId, connectedAt: device.connectedAt, userAgent: device.userAgent,
  }));
}

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  socket.on('join-network', (payload = {}) => {
    const { deviceId, deviceName, deviceType, networkId, userAgent } = payload;
    if (![deviceId, deviceName, deviceType, networkId].every(validId)) return;
    const network = getNetwork(networkId);
    const previous = network.get(deviceId);
    if (previous?.socketId && previous.socketId !== socket.id) io.sockets.sockets.get(previous.socketId)?.leave(networkId);
    socket.join(networkId);
    socket.data.deviceId = deviceId;
    socket.data.networkId = networkId;
    network.set(deviceId, {
      deviceId, socketId: socket.id, name: deviceName.trim(), type: deviceType,
      status: 'Ready to receive', networkId, connectedAt: previous?.connectedAt || new Date().toISOString(), userAgent: userAgent || '',
    });
    console.log('Device joined network:', deviceName.trim(), deviceId);
    console.log('Active devices:', network.size);
    io.to(networkId).emit('online-devices-updated', publicDevices(network));
  });

  socket.on('refresh-devices', ({ networkId } = {}) => {
    if (!validId(networkId) || socket.data.networkId !== networkId) return;
    socket.emit('online-devices-updated', publicDevices(getNetwork(networkId)));
  });

  function forwardTransfer(event, payload = {}) {
    const { networkId, targetDeviceId, senderDeviceId, transferId, ...data } = payload;
    const fromDeviceId = senderDeviceId || socket.data.deviceId;
    if (!validId(networkId) || !validId(targetDeviceId) || !validId(fromDeviceId) || !validId(transferId) || socket.data.deviceId !== fromDeviceId || socket.data.networkId !== networkId) return;
    const target = getNetwork(networkId).get(targetDeviceId);
    if (!target) {
      socket.emit('transfer-response', { transferId, accepted: false, reason: 'Device is no longer available' });
      return;
    }
    console.log('[Transfer] Forwarding', event, 'from:', socket.id, 'to device:', targetDeviceId, 'socket:', target.socketId);
    io.to(target.socketId).emit(event, { transferId, ...data, senderDeviceId: fromDeviceId });
  }

  socket.on('transfer-request', (payload = {}) => {
    console.log('[Transfer] Request received:', socket.id, 'target device:', payload.targetDeviceId);
    forwardTransfer('incoming-transfer-request', payload);
  });

  socket.on('transfer-response', (payload = {}) => {
    const { networkId, transferId, senderDeviceId, accepted, reason } = payload;
    if (!validId(networkId) || !validId(transferId) || !validId(senderDeviceId) || socket.data.networkId !== networkId || socket.data.deviceId === senderDeviceId) return;
    const sender = getNetwork(networkId).get(senderDeviceId);
    if (!sender) return;
    console.log('[Transfer] Response received:', socket.id, 'accepted:', accepted, 'forwarding to:', sender.socketId);
    io.to(sender.socketId).emit('transfer-response', { transferId, accepted: accepted === true, reason: reason || '' });
  });

  socket.on('transfer-cancel', (payload = {}) => {
    console.log('[Transfer] Cancellation received:', socket.id, 'target device:', payload.targetDeviceId);
    forwardTransfer('incoming-transfer-cancelled', payload);
  });

  function forward(event, { networkId, fromDeviceId, toDeviceId, ...rest } = {}) {
    if (!validId(networkId) || !validId(fromDeviceId) || !validId(toDeviceId) || socket.data.deviceId !== fromDeviceId || socket.data.networkId !== networkId) return;
    const target = getNetwork(networkId).get(toDeviceId);
    console.log('[Signal Server]', event, 'from socket:', socket.id, 'target deviceId:', toDeviceId, 'target socket:', target?.socketId || 'not found');
    if (target) io.to(target.socketId).emit(event, { fromDeviceId, ...rest });
  }
  socket.on('signal-offer', (payload) => forward('signal-offer', payload));
  socket.on('signal-answer', (payload) => forward('signal-answer', payload));
  socket.on('ice-candidate', (payload) => forward('ice-candidate', payload));

  socket.on('disconnect', (reason) => {
    const { networkId, deviceId } = socket.data;
    console.log('Socket disconnected:', socket.id, reason);
    const network = networks.get(networkId);
    if (!network || !deviceId || network.get(deviceId)?.socketId !== socket.id) return;
    const removedDevice = network.get(deviceId);
    network.delete(deviceId);
    console.log('Device removed:', removedDevice?.name || deviceId);
    if (network.size === 0) networks.delete(networkId);
    else io.to(networkId).emit('online-devices-updated', publicDevices(network));
  });
});

const PORT = 4000;
server.listen(PORT, '0.0.0.0', () => console.log(`NACOSDU-SHARE signaling server running on http://localhost:${PORT}`));
