const BACKEND = "http://localhost:8000/api/student-attendance/v1";

const field = document.querySelector(".class-id-field");
const button = document.querySelector(".class-id-button");
const video = document.getElementById("vid");
const brightnessInput = document.getElementById("brightness");
const contrastInput = document.getElementById("contrast");

let classID = "";
let mediaStream = null;

function httpReq(url, type = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(type, url, true);

    xhr.setRequestHeader(
      "Content-type",
      body ? "application/json" : "application/x-www-form-urlencoded"
    );
    xhr.setRequestHeader("ngrok-skip-browser-warning", "true");

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          resolve(xhr.responseText);
        }
      } else {
        reject(xhr.status);
      }
    };

    xhr.onerror = () => reject("Network error");
    xhr.send(body ? JSON.stringify(body) : null);
  });
}

Promise.all([
  faceapi.nets.faceRecognitionNet.loadFromUri("../assets/models/"),
  faceapi.nets.faceLandmark68Net.loadFromUri("../assets/models/"),
  faceapi.nets.ssdMobilenetv1.loadFromUri("../assets/models/")
]).then(() => console.log("FaceAPI ready"));

let attendanceModeIn = "1";
let attendanceModeOut = "0";

const attendanceLock = new Map();
const COOLDOWN_MS = 10000;

async function saveAttendance(studentId) {
  if (!studentId || studentId === "unknown") return;

  const now = Date.now();
  if (attendanceLock.has(studentId)) {
    if (now - attendanceLock.get(studentId) < COOLDOWN_MS) return;
  }
  attendanceLock.set(studentId, now);

  try {
    if (attendanceModeIn === "1") {
      await httpReq(`${BACKEND}/attendance`, "POST", {
        student_id: studentId,
        in: "1",
        out: "0",
        class_id: classID
      });
    } else {
      await httpReq(`${BACKEND}/attendance/${studentId}?class_id=` + classID, "PATCH", {});
    }

    await getAttendanceToday();
  } catch (err) {
    console.error(err);
  }
}

async function getAttendanceToday() {
  if (!classID) return;

  const output = await httpReq(
    `${BACKEND}/attendance/today?class_id=${classID}`
  );

  const grid = document.querySelector(".grid-container");
  grid.innerHTML = "";

  ["Name", "In", "Out", "Class"].forEach((h) => {
    const d = document.createElement("div");
    d.className = "grid-item";
    d.textContent = h;
    grid.appendChild(d);
  });

  output.forEach((r) => {
    ["name", "in_time", "out_time", "class_id"].forEach((k) => {
      const d = document.createElement("div");
      d.className = "grid-item";
      d.textContent = r[k] || "-";
      grid.appendChild(d);
    });
  });
}

async function trainer(labels) {
  const descriptors = [];

  for (const label of labels) {
    if (!label?.imagesName) continue;

    const descs = [];
    for (const imgName of label.imagesName) {
      const img = await faceapi.fetchImage(
        `../Images/${label.imageCode}/${imgName}`
      );
      const det = await faceapi
        .detectSingleFace(img)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (det) descs.push(det.descriptor);
    }

    if (descs.length) {
      descriptors.push(
        new faceapi.LabeledFaceDescriptors(label.imageCode, descs)
      );
    }
  }
  return descriptors;
}

async function startCamera() {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    video: { width: video.width, height: video.height }
  });
  video.srcObject = mediaStream;
}

video.addEventListener("play", async () => {
  const students = await httpReq(`${BACKEND}/student/image`);
  const trained = await trainer(students);
  const matcher = new faceapi.FaceMatcher(trained, 0.7);

  const canvas = faceapi.createCanvasFromMedia(video);
  document.body.append(canvas);

  canvas.style.position = 'absolute';

  const videoRect = video.getBoundingClientRect();
  // canvas.style.position = 'absolute';
  canvas.style.left = `${videoRect.left}px`;
  canvas.style.top = `${videoRect.top}px`;

  const displaySize = {
    width: video.width,
    height: video.height
  };

  faceapi.matchDimensions(canvas, displaySize);
  const ctx = canvas.getContext("2d");

  setInterval(async () => {
    const detections = await faceapi
      .detectAllFaces(video)
      .withFaceLandmarks()
      .withFaceDescriptors();

    const resized = faceapi.resizeResults(detections, displaySize);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    resized.forEach(async (d) => {
      const match = matcher.findBestMatch(d.descriptor);
      const studentId = match.label;
      const color = studentId === "unknown" ? "red" : "green";

      await saveAttendance(studentId.split("~")[0]);

      const box = d.detection.box;

      const smallBox = {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height
      };

      const drawBox = new faceapi.draw.DrawBox(smallBox, {
        label: studentId.split("~")[1],
        boxColor: color
      });
      drawBox.draw(canvas);
    });
  }, 2000);
});

async function verifyClass() {
  const output = await httpReq(`${BACKEND}/class/${field.value}`);
  if (output.ID === field.value) {
    classID = field.value;
    field.disabled = true;
    button.disabled = true;
    button.innerText = "Success!";
    await getAttendanceToday();
    await startCamera();
  } else {
    alert("Log In - Failed")
  }
}


brightnessInput.addEventListener("input", updateStyles);
contrastInput.addEventListener("input", updateStyles);

function updateStyles() {
  video.style.filter = `brightness(${brightnessInput.value}%) contrast(${contrastInput.value}%)`;
}


document.getElementById("mode").addEventListener("change", (e) => {
  attendanceModeIn = e.target.checked ? "0" : "1";
  attendanceModeOut = e.target.checked ? "1" : "0";
});