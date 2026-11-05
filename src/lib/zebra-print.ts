/**
 * Direct printing to Zebra Link-OS printers (e.g. ZQ320 Plus) over Web Bluetooth.
 *
 * Uses the Zebra Bluetooth LE Parser Service documented in Zebra's application
 * note "Link-OS Environment Bluetooth Low Energy": a minimal GATT service that
 * behaves like a serial port into the printer's ZPL parser.
 */

const ZEBRA_PARSER_SERVICE_UUID = "38eb4a80-c570-11e3-9507-0002a5d5c51b";
const ZEBRA_TO_PRINTER_CHARACTERISTIC_UUID = "38eb4a82-c570-11e3-9507-0002a5d5c51b";
const ZEBRA_ADVERTISED_SERVICE_UUID = 0xfe79;

/** ZQ320 Plus print head: 203 dpi across a 72 mm (2.83 in) print width. */
const PRINTER_WIDTH_DOTS = 576;

/** Conservative BLE write payload; the ZQ320 negotiates a small MTU, and large
    writes can stall or drop the link mid-print. */
const BLE_CHUNK_SIZE = 100;

/** Delay between BLE writes so the printer's parser buffer is not overrun. */
const BLE_WRITE_DELAY_MS = 60;

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

const canvasToZplGraphic = (canvas: HTMLCanvasElement): string => {
	const { bytesPerRow, rows } = canvasToBitmapRows(canvas);
	const trimmed = trimBlankRows(rows, bytesPerRow);
	const totalBytes = bytesPerRow * trimmed.length;
	return `^GFA,${totalBytes},${totalBytes},${bytesPerRow},${trimmed.join("")}`;
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

/**
 * Renders the given element and prints it on a Zebra printer over Bluetooth LE.
 * The browser shows its Bluetooth device picker on the first print of a session.
 */
export const printElementToZebra = async (element: HTMLElement) => {
	if (!isZebraPrintSupported()) {
		throw new Error("This browser does not support direct Zebra printing. Use Chrome on Android, or use Print Receipt instead.");
	}

	const { default: html2canvas } = await import("html2canvas");
	const rendered = await html2canvas(element, {
		backgroundColor: "#ffffff",
		scale: PRINTER_WIDTH_DOTS / element.offsetWidth,
	});

	const zpl = `^XA^PW${PRINTER_WIDTH_DOTS}^FO0,0${canvasToZplGraphic(rendered)}^FS^XZ`;
	const payload: Uint8Array<ArrayBuffer> = new TextEncoder().encode(zpl);

	const device = await navigator.bluetooth.requestDevice({
		filters: [{ services: [ZEBRA_ADVERTISED_SERVICE_UUID] }],
		optionalServices: [ZEBRA_PARSER_SERVICE_UUID],
	});
	if (!device.gatt) throw new Error("The selected device does not support Bluetooth LE printing.");

	const server = await device.gatt.connect();
	try {
		const service = await server.getPrimaryService(ZEBRA_PARSER_SERVICE_UUID);
		const characteristic = await service.getCharacteristic(ZEBRA_TO_PRINTER_CHARACTERISTIC_UUID);
		await writeToPrinter(device, characteristic, payload);
	} finally {
		server.disconnect();
	}
};
