/**
 * Direct printing to Zebra Link-OS printers (e.g. ZQ320 Plus) over Web Bluetooth.
 *
 * Uses the Zebra Bluetooth LE Parser Service documented in Zebra's application
 * note "Link-OS Environment Bluetooth Low Energy": a minimal GATT service that
 * behaves like a serial port into the printer's ZPL parser.
 */

const ZEBRA_PARSER_SERVICE_UUID = "38eb4a80-c570-11e3-9507-0002a5d5c51b";
const ZEBRA_FROM_PRINTER_CHARACTERISTIC_UUID = "38eb4a81-c570-11e3-9507-0002a5d5c51b";
const ZEBRA_TO_PRINTER_CHARACTERISTIC_UUID = "38eb4a82-c570-11e3-9507-0002a5d5c51b";
const ZEBRA_ADVERTISED_SERVICE_UUID = 0xfe79;

/** ZQ320 Plus print head: 203 dpi across a 72 mm (2.83 in) print width. */
const PRINTER_WIDTH_DOTS = 576;

/** BLE write payload. Kept modest - the ZQ320's parser buffer is small and
    large writes overrun it (garbled output). */
const BLE_CHUNK_SIZE = 240;

/** Pause between BLE writes so the printer's parser buffer is not overrun.
    30 ms was proven clean; 20 ms is still safe with the smaller payload. */
const BLE_WRITE_DELAY_MS = 20;

export const isZebraPrintSupported = () =>
	typeof navigator !== "undefined" && typeof navigator.bluetooth !== "undefined";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const toHex = (value: number, width: number) => value.toString(16).toUpperCase().padStart(width, "0");

/**
 * Converts a canvas to monochrome bitmap rows (hex strings), one per pixel row.
 * Pixels darker than the threshold become print dots.
 */
const canvasToBitmapRows = (canvas: HTMLCanvasElement) => {
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Unable to read the rendered receipt image.");

	const { width, height } = canvas;
	const bytesPerRow = Math.ceil(width / 8);
	const { data } = context.getImageData(0, 0, width, height);
	const rows: string[] = [];

	for (let y = 0; y < height; y += 1) {
		let row = "";
		for (let byteIndex = 0; byteIndex < bytesPerRow; byteIndex += 1) {
			let byte = 0;
			for (let bit = 0; bit < 8; bit += 1) {
				const x = byteIndex * 8 + bit;
				if (x >= width) continue;
				const offset = (y * width + x) * 4;
				const luminance = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
				if (luminance < 160) byte |= 0x80 >> bit;
			}
			row += toHex(byte, 2);
		}
		rows.push(row);
	}

	const totalBytes = bytesPerRow * height;
	return { bytesPerRow, rows, totalBytes };
};

/** Drops blank rows from the bottom of the bitmap so we send less data over BLE. */
const trimBlankRows = (rows: string[], bytesPerRow: number) => {
	const blankRow = "0".repeat(bytesPerRow * 2);
	let end = rows.length;
	while (end > 0 && rows[end - 1] === blankRow) end -= 1;
	return rows.slice(0, end);
};

// Note: ZPL's run-length "alternative data compression" was tried and produced
// garbled output on the ZQ320 over BLE (the parser appears to mishandle the
// repeat-count letters at speed), so we send plain uncompressed hex rows.

/**
 * Splits the canvas into horizontal bands and packs them into a single ZPL
 * format: one ^GFA graphic field per band at increasing y offsets. Banding
 * keeps each graphic field small enough for the printer's parser, while a
 * single format avoids the printer feeding to the tear-off position between
 * bands (which left long blank gaps on the receipt).
 */
const canvasToZpl = (canvas: HTMLCanvasElement, bandHeight = 200): string => {
	const { bytesPerRow, rows } = canvasToBitmapRows(canvas);
	const trimmed = trimBlankRows(rows, bytesPerRow);
	const fields: string[] = [];

	for (let start = 0; start < trimmed.length; start += bandHeight) {
		const bandRows = trimmed.slice(start, start + bandHeight);
		const totalBytes = bytesPerRow * bandRows.length;
		fields.push(`^FO0,${start}^GFA,${totalBytes},${totalBytes},${bytesPerRow},${bandRows.join("")}^FS`);
	}
	if (fields.length === 0) return "";
	return `^XA^PW${PRINTER_WIDTH_DOTS}^MNN${fields.join("")}^XZ`;
};

const writeToPrinter = async (
	device: BluetoothDevice,
	characteristic: BluetoothRemoteGATTCharacteristic,
	payload: Uint8Array<ArrayBuffer>,
) => {
	for (let offset = 0; offset < payload.length; offset += BLE_CHUNK_SIZE) {
		if (!device.gatt?.connected) {
			throw new Error("Lost the Bluetooth connection to the printer mid-print. Keep the printer awake and close to the phone, then try again.");
		}
		await characteristic.writeValueWithResponse(payload.subarray(offset, offset + BLE_CHUNK_SIZE));
		await delay(BLE_WRITE_DELAY_MS);
	}
};

/** Connects to a Zebra printer over BLE and returns the device + write target. */
const connectToPrinter = async () => {
	const device = await navigator.bluetooth.requestDevice({
		filters: [{ services: [ZEBRA_ADVERTISED_SERVICE_UUID] }],
		optionalServices: [ZEBRA_PARSER_SERVICE_UUID],
	});
	if (!device.gatt) throw new Error("The selected device does not support Bluetooth LE printing.");

	const server = await device.gatt.connect();
	const service = await server.getPrimaryService(ZEBRA_PARSER_SERVICE_UUID);
	const characteristic = await service.getCharacteristic(ZEBRA_TO_PRINTER_CHARACTERISTIC_UUID);
	return { device, server, service, characteristic };
};

const sendZpl = async (
	device: BluetoothDevice,
	characteristic: BluetoothRemoteGATTCharacteristic,
	zpl: string,
) => {
	const payload: Uint8Array<ArrayBuffer> = new TextEncoder().encode(zpl);
	await writeToPrinter(device, characteristic, payload);
};

/**
 * Renders the given element and prints it on a Zebra printer over Bluetooth LE.
 * The browser shows its Bluetooth device picker on the first print of a session.
 */
export const printElementToZebra = async (element: HTMLElement) => {
	if (!isZebraPrintSupported()) {
		throw new Error("This browser does not support direct Zebra printing. Use Chrome on Android, or use Print Receipt instead.");
	}

	// Wait for images (the logo) to finish loading before rasterizing.
	const images = Array.from(element.querySelectorAll("img"));
	await Promise.all(
		images.map((img) =>
			img.complete && img.naturalWidth > 0
				? Promise.resolve()
				: new Promise<void>((resolve) => {
						img.addEventListener("load", () => resolve(), { once: true });
						img.addEventListener("error", () => resolve(), { once: true });
					}),
		),
	);

	const { default: html2canvas } = await import("html2canvas");
	const rendered = await html2canvas(element, {
		backgroundColor: "#ffffff",
		scale: PRINTER_WIDTH_DOTS / element.offsetWidth,
	});

	const zpl = canvasToZpl(rendered);
	if (!zpl) throw new Error("The receipt rendered as a blank image.");

	const { device, server, characteristic } = await connectToPrinter();
	try {
		await sendZpl(device, characteristic, zpl);
		// Feed so the receipt can be torn off.
		await sendZpl(device, characteristic, "^XA^XZ\n\n\n");
	} finally {
		server.disconnect();
	}
};

/**
 * Prints a tiny test pattern (a box and a line of text) to confirm the BLE
 * pipeline works end to end without sending a large bitmap.
 */
export const printZebraTestPattern = async () => {
	if (!isZebraPrintSupported()) {
		throw new Error("This browser does not support direct Zebra printing. Use Chrome on Android.");
	}
	const { server, characteristic, device } = await connectToPrinter();
	try {
		await sendZpl(device, characteristic, "^XA^PW576^MNN^FO20,20^GB536,4,4^FS^FO20,60^ADN,36,20^FDZEBRA TEST OK^FS^FO20,140^GB536,4,4^FS^XZ\n\n\n");
	} finally {
		server.disconnect();
	}
};

/**
 * Asks the printer for its host status and device errors over BLE and returns
 * the raw responses, so we can see whether it is in ZPL mode and whether it is
 * reporting a fault (head open, out of paper, etc.).
 */
export const queryZebraStatus = async (): Promise<string> => {
	if (!isZebraPrintSupported()) {
		throw new Error("This browser does not support direct Zebra printing. Use Chrome on Android.");
	}

	const device = await navigator.bluetooth.requestDevice({
		filters: [{ services: [ZEBRA_ADVERTISED_SERVICE_UUID] }],
		optionalServices: [ZEBRA_PARSER_SERVICE_UUID],
	});
	if (!device.gatt) throw new Error("The selected device does not support Bluetooth LE printing.");

	const server = await device.gatt.connect();
	try {
		const service = await server.getPrimaryService(ZEBRA_PARSER_SERVICE_UUID);
		const toPrinter = await service.getCharacteristic(ZEBRA_TO_PRINTER_CHARACTERISTIC_UUID);
		const fromPrinter = await service.getCharacteristic(ZEBRA_FROM_PRINTER_CHARACTERISTIC_UUID);

		const chunks: string[] = [];
		const decoder = new TextDecoder();
		const onData = (event: Event) => {
			const target = event.target as BluetoothRemoteGATTCharacteristic;
			if (target.value) chunks.push(decoder.decode(target.value));
		};
		fromPrinter.addEventListener("characteristicvaluechanged", onData);
		await fromPrinter.startNotifications();

		// ~HS = host status, ~ES = device errors. Both answer on the parser port.
		const query: Uint8Array<ArrayBuffer> = new TextEncoder().encode("~HS\n~ES\n");
		await writeToPrinter(device, toPrinter, query);

		// Give the printer a moment to answer.
		await delay(1500);
		await fromPrinter.stopNotifications();
		fromPrinter.removeEventListener("characteristicvaluechanged", onData);

		const response = chunks.join("").trim();
		return response || "(the printer did not answer — it may not be in ZPL mode)";
	} finally {
		server.disconnect();
	}
};
