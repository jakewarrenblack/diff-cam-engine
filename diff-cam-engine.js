const DiffCamEngine = (function() {
	let canvas				// shows stream
	let captureCanvas;			// internal canvas for capturing full images from video
	let captureContext;			// context for capture canvas
	let diffCanvas;				// internal canvas for diffing downscaled captures
	let diffContext;			// context for diff canvas
	let motionCanvas;			// receives processed diff images
	let motionContext;			// context for motion canvas

	let initSuccessCallback;	// called when init succeeds
	let initErrorCallback;		// called when init fails
	let startCompleteCallback;	// called when start is complete
	let captureCallback;		// called when an image has been captured and diffed

	let captureInterval;		// interval for continuous captures
	let captureIntervalTime;	// time between captures, in ms
	let captureWidth;			// full captured image width
	let captureHeight;			// full captured image height
	let diffWidth;				// downscaled width for diff/motion
	let diffHeight;				// downscaled height for diff/motion
	let isReadyToDiff;			// has a previous capture been made to diff against?
	let pixelDiffThreshold;		// min for a pixel to be considered significant
	let scoreThreshold;			// min for an image to be considered significant
	let includeMotionBox;		// flag to calculate and draw motion bounding box
	let includeMotionPixels;	// flag to create object denoting pixels with motion
	let coords;

	function init(options) {
		// sanity check
		if (!options) {
			throw 'No options object provided';
		}

		// incoming options with defaults
		canvas = options.canvas || document.createElement('canvas');
		motionCanvas = options.motionCanvas || document.createElement('canvas');
		captureIntervalTime = options.captureIntervalTime || 100;
		captureWidth = canvas.width || 640;
		captureHeight = canvas.height || 480;
		diffWidth = canvas.width || 64;
		diffHeight = canvas.height || 48;
		pixelDiffThreshold = options.pixelDiffThreshold || 32;
		scoreThreshold = options.scoreThreshold || 16;
		includeMotionBox = options.includeMotionBox || false;
		includeMotionPixels = options.includeMotionPixels || false;

		// callbacks
		initSuccessCallback = options.initSuccessCallback || function() {};
		initErrorCallback = options.initErrorCallback || function() {};
		startCompleteCallback = options.startCompleteCallback || function() {};
		captureCallback = options.captureCallback || function() {};

		// non-configurable
		captureCanvas = document.createElement('canvas');
		diffCanvas = document.createElement('canvas');
		isReadyToDiff = false;


		// prep capture canvas
		captureCanvas.width = captureWidth;
		captureCanvas.height = captureHeight;
		captureContext = captureCanvas.getContext('2d');

		// prep diff canvas
		diffCanvas.width = diffWidth;
		diffCanvas.height = diffHeight;
		diffContext = diffCanvas.getContext('2d');

		// prep motion canvas
		motionCanvas.width = diffWidth;
		motionCanvas.height = diffHeight;
		motionContext = motionCanvas.getContext('2d');

		initSuccess()
	}



	function initSuccess() {
		initSuccessCallback();
	}

	function initError(error) {
		console.log(error);
		initErrorCallback();
	}

	function start() {
		if (!canvas) {
			throw "Can't do anything without a video canvas!" ;
		}

		// streaming takes a moment to start
		// video.addEventListener('canplay', startComplete);
		// video.srcObject = stream;
		startComplete()
	}

	function startComplete() {
		captureInterval = setInterval(capture, captureIntervalTime);
		startCompleteCallback();
	}

	function stop() {
		clearInterval(captureInterval);
		canvas.clearRect(0,0,canvas.width,canvas.height)
		motionContext.clearRect(0, 0, diffWidth, diffHeight);
		isReadyToDiff = false;
	}

	function capture() {
		let self = this;

		// Create an ImageData object to store the current frame from the canvas
		let canvasData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);

		// If this is the first frame, store it as the background
		if (!this.prevImageData) {
			this.prevImageData = canvasData;
			return;
		}

		// Store the current frame as the previous frame for the next iteration
		this.prevImageData = canvasData;


		// save a full-sized copy of capture
		captureContext.drawImage(canvas, 0, 0, canvas.width, canvas.height);
		let captureImageData = captureContext.getImageData(0, 0, canvas.width, canvas.height);

		// diff current capture over previous capture, leftover from last time
		diffContext.globalCompositeOperation = 'difference';
		diffContext.drawImage(canvas, 0, 0, canvas.width, canvas.height);
		let diffImageData = diffContext.getImageData(0, 0, canvas.width, canvas.height);

		if (isReadyToDiff) {
			let diff = processDiff(diffImageData);

			motionContext.putImageData(diffImageData, 0, 0);
			if (diff.motionBox) {
				motionContext.strokeStyle = '#fff';
				motionContext.strokeRect(
					diff.motionBox.x.min + 0.5,
					diff.motionBox.y.min + 0.5,
					diff.motionBox.x.max - diff.motionBox.x.min,
					diff.motionBox.y.max - diff.motionBox.y.min
				);
			}
			captureCallback({
				imageData: captureImageData,
				score: diff.score,
				hasMotion: diff.score >= scoreThreshold,
				motionBox: diff.motionBox,
				motionPixels: diff.motionPixels,
				getURL: function() {
					return getCaptureUrl(this.imageData);
				},
				checkMotionPixel: function(x, y) {
					return checkMotionPixel(this.motionPixels, x, y)
				}
			});
		}

		// draw current capture normally over diff, ready for next time
		diffContext.globalCompositeOperation = 'source-over';
		diffContext.drawImage(canvas, 0, 0, canvas.width, canvas.height);
		isReadyToDiff = true;
	}

	function processDiff(diffImageData) {
		let rgba = diffImageData.data;

		// pixel adjustments are done by reference directly on diffImageData
		let score = 0;
		let motionPixels = includeMotionPixels ? [] : undefined;
		let motionBox = undefined;
		for (var i = 0; i < rgba.length; i += 4) {
			var pixelDiff = rgba[i] * 0.3 + rgba[i + 1] * 0.6 + rgba[i + 2] * 0.1;
			var normalized = Math.min(255, pixelDiff * (255 / pixelDiffThreshold));
			rgba[i] = 0;
			rgba[i + 1] = normalized;
			rgba[i + 2] = 0;

			if (pixelDiff >= pixelDiffThreshold) {
				score++;
				coords = calculateCoordinates(i / 4);

				if (includeMotionBox) {
					motionBox = calculateMotionBox(motionBox, coords.x, coords.y);
				}

				if (includeMotionPixels) {
					motionPixels = calculateMotionPixels(motionPixels, coords.x, coords.y, pixelDiff);
				}

			}
		}

		return {
			score: score,
			motionBox: score > scoreThreshold ? motionBox : undefined,
			motionPixels: motionPixels
		};
	}

	function calculateCoordinates(pixelIndex) {
		return {
			x: pixelIndex % diffWidth,
			y: Math.floor(pixelIndex / diffWidth)
		};
	}

	function calculateMotionBox(currentMotionBox, x, y) {
		// init motion box on demand
		var motionBox = currentMotionBox || {
			x: { min: coords.x, max: x },
			y: { min: coords.y, max: y }
		};

		motionBox.x.min = Math.min(motionBox.x.min, x);
		motionBox.x.max = Math.max(motionBox.x.max, x);
		motionBox.y.min = Math.min(motionBox.y.min, y);
		motionBox.y.max = Math.max(motionBox.y.max, y);

		return motionBox;
	}

	function calculateMotionPixels(motionPixels, x, y, pixelDiff) {
		motionPixels[x] = motionPixels[x] || [];
		motionPixels[x][y] = true;

		return motionPixels;
	}

	function getCaptureUrl(captureImageData) {
		// may as well borrow captureCanvas
		captureContext.putImageData(captureImageData, 0, 0);
		return captureCanvas.toDataURL();
	}

	function checkMotionPixel(motionPixels, x, y) {
		return motionPixels && motionPixels[x] && motionPixels[x][y];
	}

	function getPixelDiffThreshold() {
		return pixelDiffThreshold;
	}

	function setPixelDiffThreshold(val) {
		pixelDiffThreshold = val;
	}

	function getScoreThreshold() {
		return scoreThreshold;
	}

	function setScoreThreshold(val) {
		scoreThreshold = val;
	}

	return {
		// public getters/setters
		getPixelDiffThreshold: getPixelDiffThreshold,
		setPixelDiffThreshold: setPixelDiffThreshold,
		getScoreThreshold: getScoreThreshold,
		setScoreThreshold: setScoreThreshold,

		// public functions
		init: init,
		start: start,
		stop: stop
	};
})();