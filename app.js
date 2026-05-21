const CONFIG = {

    // FILE MODEL AI
    modelPath: './best.onnx',

    // LABEL CLASS
    // GANTI SESUAI ROBOFLOW
    labels: ["API", "TIDAK_API"],

    // TINGKAT KEYAKINAN AI
    threshold: 0.50,

    // NMS
    iouThreshold: 0.4
};

// ======================================================
// ELEMENT HTML
// ======================================================

const video = document.getElementById('webcam');
const overlay = document.getElementById('overlay');
const ctxOverlay = overlay.getContext('2d');

const processor = document.getElementById('processor');
const ctxProcessor = processor.getContext('2d', {
    willReadFrequently: true
});

const status = document.getElementById('status');
const initBtn = document.getElementById('btn-init');

const alarm = document.getElementById('alarmSound');

let session;
let alarmPlaying = false;

const TARGET_SIZE = 640;

// ======================================================
// LOAD MODEL
// ======================================================

initBtn.addEventListener('click', async () => {

    initBtn.disabled = true;
    initBtn.innerText = "MEMUAT AI...";

    try {

        ort.env.wasm.wasmPaths =
            'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';

        session = await ort.InferenceSession.create(
            CONFIG.modelPath,
            {
                executionProviders: ['webgl', 'wasm']
            }
        );

        startCamera();

    } catch (e) {

        status.innerText =
            "❌ GAGAL MEMUAT MODEL AI";

        console.error(e);
    }
});

// ======================================================
// START CAMERA
// ======================================================

async function startCamera() {

    const stream =
        await navigator.mediaDevices.getUserMedia({

            video: {
                width: 640,
                height: 480
            },

            audio: false
        });

    video.srcObject = stream;

    video.onloadedmetadata = () => {

        video.play();

        status.innerHTML =
            "🟢 SISTEM AKTIF";

        initBtn.style.display = "none";

        requestAnimationFrame(processFrame);
    };
}

// ======================================================
// DETECTION LOOP
// ======================================================

async function processFrame() {

    if (!session) return;

    // AMBIL FRAME VIDEO
    ctxProcessor.drawImage(
        video,
        0,
        0,
        TARGET_SIZE,
        TARGET_SIZE
    );

    const imageData =
        ctxProcessor.getImageData(
            0,
            0,
            TARGET_SIZE,
            TARGET_SIZE
        ).data;

    const float32Data =
        new Float32Array(
            3 * TARGET_SIZE * TARGET_SIZE
        );

    // PREPROCESS IMAGE
    for (let i = 0; i < TARGET_SIZE * TARGET_SIZE; i++) {

        float32Data[i] =
            imageData[i * 4] / 255.0;

        float32Data[
            i + TARGET_SIZE * TARGET_SIZE
        ] =
            imageData[i * 4 + 1] / 255.0;

        float32Data[
            i + 2 * TARGET_SIZE * TARGET_SIZE
        ] =
            imageData[i * 4 + 2] / 255.0;
    }

    // AI PROCESS
    const inputTensor =
        new ort.Tensor(
            'float32',
            float32Data,
            [1, 3, TARGET_SIZE, TARGET_SIZE]
        );

    const results =
        await session.run({
            [session.inputNames[0]]: inputTensor
        });

    const output =
        results[
            session.outputNames[0]
        ].data;

    // ======================================================
    // DETECTION
    // ======================================================

    const numClasses =
        CONFIG.labels.length;

    const elements = 8400;

    let rawBoxes = [];

    for (let i = 0; i < elements; i++) {

        let maxScore = 0;
        let classId = -1;

        for (let c = 0; c < numClasses; c++) {

            const score =
                output[
                    i + (4 + c) * elements
                ];

            if (score > maxScore) {

                maxScore = score;
                classId = c;
            }
        }

        if (maxScore > CONFIG.threshold) {

            let x = output[i];
            let y = output[i + elements];
            let w = output[i + 2 * elements];
            let h = output[i + 3 * elements];

            if (w <= 1.5) {

                x *= TARGET_SIZE;
                y *= TARGET_SIZE;
                w *= TARGET_SIZE;
                h *= TARGET_SIZE;
            }

            rawBoxes.push({

                x: x - w / 2,
                y: y - h / 2,

                w: w,
                h: h,

                score: maxScore,
                classId: classId
            });
        }
    }

    // ======================================================
    // NMS
    // ======================================================

    const finalBoxes =
        nonMaxSuppression(
            rawBoxes,
            CONFIG.iouThreshold
        );

    // DRAW
    drawBoxes(finalBoxes);

    // ======================================================
    // FIRE DETECTION LOGIC
    // ======================================================

    let fireDetected = false;

    finalBoxes.forEach(box => {

        const label =
            CONFIG.labels[box.classId];

        // DETEKSI API
        if (label === "API") {

            fireDetected = true;
        }
    });

    // JALANKAN ALARM
    if (fireDetected) {

        activateAlarm();

    } else {

        stopAlarm();
    }

    requestAnimationFrame(processFrame);
}

// ======================================================
// ALARM SYSTEM
// ======================================================

function activateAlarm() {

    status.innerHTML =
        "🚨 API TERDETEKSI 🚨";

    status.style.background =
        "#3b0000";

    status.style.border =
        "2px solid red";

    status.style.boxShadow =
        "0 0 20px red";

    document.body.style.background =
        "#220000";

    // ANTI SPAM SOUND
    if (!alarmPlaying) {

        alarm.play();

        alarmPlaying = true;
    }
}

function stopAlarm() {

    status.innerHTML =
        "🟢 SISTEM AMAN";

    status.style.background =
        "#111";

    status.style.border =
        "2px solid #444";

    status.style.boxShadow =
        "none";

    document.body.style.background =
        "#050505";

    alarm.pause();

    alarm.currentTime = 0;

    alarmPlaying = false;
}

// ======================================================
// IOU
// ======================================================

function calculateIoU(box1, box2) {

    const xA =
        Math.max(box1.x, box2.x);

    const yA =
        Math.max(box1.y, box2.y);

    const xB =
        Math.min(
            box1.x + box1.w,
            box2.x + box2.w
        );

    const yB =
        Math.min(
            box1.y + box1.h,
            box2.y + box2.h
        );

    const intersectionArea =
        Math.max(0, xB - xA) *
        Math.max(0, yB - yA);

    return intersectionArea /
        (
            (box1.w * box1.h) +
            (box2.w * box2.h) -
            intersectionArea
        );
}

// ======================================================
// NMS
// ======================================================

function nonMaxSuppression(
    boxes,
    iouThreshold
) {

    boxes.sort(
        (a, b) => b.score - a.score
    );

    const result = [];

    while (boxes.length > 0) {

        const current =
            boxes.shift();

        result.push(current);

        boxes =
            boxes.filter(box =>
                calculateIoU(
                    current,
                    box
                ) < iouThreshold
            );
    }

    return result;
}

// ======================================================
// DRAW BOXES
// ======================================================

function drawBoxes(boxes) {

    ctxOverlay.clearRect(
        0,
        0,
        overlay.width,
        overlay.height
    );

    boxes.forEach(box => {

        const scaleX =
            overlay.width / TARGET_SIZE;

        const scaleY =
            overlay.height / TARGET_SIZE;

        const x =
            box.x * scaleX;

        const y =
            box.y * scaleY;

        const w =
            box.w * scaleX;

        const h =
            box.h * scaleY;

        // WARNA BERDASARKAN CLASS
        let color =
            CONFIG.labels[box.classId] === "API"
            ? "#FF3B30"
            : "#34C759";

        // BOX
        ctxOverlay.strokeStyle = color;

        ctxOverlay.lineWidth = 4;

        ctxOverlay.shadowColor = color;

        ctxOverlay.shadowBlur = 20;

        ctxOverlay.strokeRect(
            x,
            y,
            w,
            h
        );

        // TEXT BG
        ctxOverlay.fillStyle = color;

        ctxOverlay.fillRect(
            x,
            y - 30,
            180,
            30
        );

        // TEXT
        ctxOverlay.fillStyle = "white";

        ctxOverlay.font =
            "bold 18px Orbitron";

        ctxOverlay.fillText(
            `${CONFIG.labels[box.classId]} ${(box.score * 100).toFixed(1)}%`,
            x + 10,
            y - 10
        );
    });
}
