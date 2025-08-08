





// ========================== IMPORTS ==========================
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";


// ========================== INIT ==========================
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});
const PORT = 5000;


// ========================== GLOBAL STATE ==========================
const roomHosts = {};              // { roomId: hostSocketId }
const pendingRequests = {};        // { socket.id: { name, roomId } }


// ========================== MAIN SOCKET CONNECTION ==========================
io.on("connection", (socket) => {
  // console.log(" User connected:", socket.id);
  let joinedRoomId = null;
  let joinedUserName = null;

  // ========== 1. JOIN REQUEST ========== //
  socket.on("request-to-join", ({ roomId, name }) => {
    if (!roomId) return;
    joinedRoomId = roomId;
    joinedUserName = name;

    const hostSocketId = roomHosts[roomId];
    if (!hostSocketId) {
      // No host exists, make this user the host
      roomHosts[roomId] = socket.id;
      socket.join(roomId);
      socket.emit("role-assigned", { isHost: true });
      // console.log(` ${name} is HOST of room: ${roomId}`);
    } else {
      // Only run this for non-hosts
      if (socket.id !== hostSocketId) {
        pendingRequests[socket.id] = { name, roomId };
        io.to(hostSocketId).emit("user-requested", {
          name,
          requesterId: socket.id,
          roomId,
        });
        socket.emit("waiting-for-approval");
      }
    }
  });

 // ========== 2. HOST RESPONSE ========== //
socket.on("host-response", ({ requesterId, approved, roomId }) => {
  const requesterSocket = io.sockets.sockets.get(requesterId);
  if (!requesterSocket || !pendingRequests[requesterId]) return;

  const { name: requesterName } = pendingRequests[requesterId];
  delete pendingRequests[requesterId];

  if (approved) {
    requesterSocket.join(roomId);

    // Let frontend know they officially joined
    requesterSocket.emit("join-approved", { roomId, hostId: socket.id });
    requesterSocket.emit("join-room-confirmed", { name: requesterName });

    // Notify others in the room
    requesterSocket.to(roomId).emit("user-joined", {
      name: requesterName,
      id: requesterId,
    });

    // Start call automatically for both
    requesterSocket.emit("start-call"); // Participant starts media
    socket.emit("start-call"); // Host also starts if not already

    // console.log(` ${requesterName} joined room: ${roomId} `);
  } else {
    requesterSocket.emit("join-rejected");
    // console.log(` ${requesterName} rejected from joining room: ${roomId}`);
  }
});





  // ========== 3. CHAT ========== //
  socket.on("send-message", ({ roomId, name, text, time }) => {
    io.to(roomId).emit("receive-message", { name, text, time });
  });

  // ========== 4. DISCONNECT ========== //
  socket.on("disconnect", () => {
    // console.log(` User disconnected: ${socket.id}`);

    // If the user had joined a room
    if (joinedRoomId && joinedUserName) {
      // Inform others in the room
      socket.to(joinedRoomId).emit("user-left", {
        name: joinedUserName,
        id: socket.id,
      });

      // console.log(` ${joinedUserName} left room: ${joinedRoomId}`);
    }

    // If this user was a pending requester, clean up
    if (pendingRequests[socket.id]) {
      // console.log(` Pending request removed for: ${socket.id}`);
      delete pendingRequests[socket.id];
    }

    // If the host disconnected
    for (const roomId in roomHosts) {
      if (roomHosts[roomId] === socket.id) {
        // console.log(` Host (${joinedUserName}) left room: ${roomId}`);
        delete roomHosts[roomId];
      }
    }
  });

  // ========== 5. WEBRTC SIGNALING ========== //
  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    // console.log(` ${socket.id} joined room: ${roomId}`);
  });

  socket.on("offer", ({ sdp, roomId }) => {
    socket.to(roomId).emit("offer", { sdp });
    // console.log(` Offer sent to room ${roomId}`);
  });

  socket.on("answer", ({ sdp, roomId }) => {
    socket.to(roomId).emit("answer", { sdp });
    // console.log(` Answer sent to room ${roomId}`);
  });

  socket.on("ice-candidate", ({ candidate, roomId }) => {
    socket.to(roomId).emit("ice-candidate", { candidate });
    // console.log(` ICE candidate sent to room ${roomId}`);
  });
});


// ========================== START SERVER ==========================
server.listen(PORT, () => {
  // console.log(` Server running at http://localhost:${PORT}`);
});
