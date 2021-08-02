console.log('workin');

const socket = io();

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
  } else {
    document.getElementById('call').style.color = '#000000';
  }
});

socket.on('callMessage', (data) => {
  console.log('message: ', data);
});
