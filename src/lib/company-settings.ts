export const companyInfo = {
	companyName: "Gerstner Oil Company",
	address: "PO Box 59, 3004 E Hwy 50",
	city: "Yankton",
	state: "SD",
	zip: "57078",
	phone: "605-665-5568",
};

export const companyCityLine =
	[companyInfo.city, companyInfo.state].filter(Boolean).join(", ") +
	(companyInfo.zip
		? `${companyInfo.city || companyInfo.state ? " " : ""}${companyInfo.zip}`
		: "");