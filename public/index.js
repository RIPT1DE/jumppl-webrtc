console.log('workin');

const socket = io();

let pc = null;
let ignoreOffer = false;
let makingOffer = false;
let polite = false;
let userId = 'asd';

// client-side
socket.on('connect', () => {
  console.log(socket.id);
});

socket.on('disconnect', () => {
  console.log(socket.id); // undefined
});

function join() {
  console.log('join');
  const id = document.getElementById('userId').value;
  userId = id;
  if (id) {
    socket.emit('join', id);
    console.log(id);
  }
}

function call() {
  console.log('call');
  const id = document.getElementById('outuserId').value;
  if (id) {
    socket.emit('initiateCall', id);
    console.log(id);
  }
}

function accept() {
  socket.emit('answerCall');
}

socket.on('incomingCall', (d) => {
  console.log('in CAll', d);

  if (d.userId) {
    document.getElementById('inCall').style.color = '#ff0000';
  } else {
    document.getElementById('inCall').style.color = '#000000';
  }
});

socket.on('callActive', (d) => {
  console.log('call Active', d);

  if (d.userId) {
    document.getElementById('call').style.color = '#ff0000';
    pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    addHandlers();
    polite = userId.localeCompare(d.userId) > 0;
  } else {
    document.getElementById('call').style.color = '#000000';
  }
});

socket.on('callMessage', async ({ description, candidate }) => {
  console.log('message: ', description, candidate);
  if (pc) {
    try {
      if (description) {
        const offerCollision =
          description.type == 'offer' &&
          (makingOffer || pc.signalingState != 'stable');

        ignoreOffer = !polite && offerCollision;
        if (ignoreOffer) {
          return;
        }

        await pc.setRemoteDescription(description);
        if (description.type == 'offer') {
          await pc.setLocalDescription();
          socket.emit('callMessage', { description: pc.localDescription });
        }
      } else if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          if (!ignoreOffer) {
            throw err;
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  }
});

function addHandlers() {
  pc.onnegotiationneeded = async () => {
    try {
      makingOffer = true;
      await pc.setLocalDescription();
      socket.emit('callMessage', { description: pc.localDescription });
    } catch (err) {
      console.error(err);
    } finally {
      makingOffer = false;
    }
  };

  pc.onicecandidate = ({ candidate }) =>
    socket.emit('callMessage', { candidate });

  let remoteVideo = document.getElementById('remoteVideo');

  pc.ontrack = ({ track, streams }) => {
    track.onunmute = () => {
      console.log('track');
      if (remoteVideo.srcObject) {
        return;
      }
      console.log('adding track');
      remoteVideo.srcObject = streams[0];
    };
  };
}
