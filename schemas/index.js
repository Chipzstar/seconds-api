exports.quoteSchema = {
	id: '',
	transport: '',
	createdAt: '',
	expireTime: '',
	dropoffEta: '',
	priceExVAT: 0.0,
	currency: '',
	providerId: ''
};

exports.jobRequestSchema = {
	pickupFirstName: '',
	pickupLastName: '',
	pickupBusinessName: '',
	pickupAddressLine1: '',
	pickupAddressLine2: '',
	pickupCity: '',
	pickupPostcode: '',
	pickupEmailAddress: '',
	pickupPhoneNumber: '',
	pickupInstructions: '',
	packagePickupStartTime: '',
	drops: [
		{
			dropoffFirstName: '',
			dropoffLastName: '',
			dropoffBusinessName: '',
			dropoffAddressLine1: '',
			dropoffAddressLine2: '',
			dropoffCity: '',
			dropoffPostcode: '',
			dropoffEmailAddress: '',
			dropoffPhoneNumber: '',
			dropoffInstructions: '',
			packageDropoffEndTime: '',
			packageDescription: ''
		}
	],
	packageDeliveryType: '',
	itemsCount: null,
	vehicleType: ''
};

exports.deliverySchema = {
	id: "",
	orderNumber: "",
	orderReference: "",
	description: "",
	dropoffStartTime: "",
	dropoffEndTime: "",
	transport: "",
	dropoffLocation: {
		fullAddress: "",
		streetAddress: "",
		city: "",
		postcode: "",
		latitude: "",
		longitude: "",
		country: 'UK',
		phoneNumber: "",
		email: "",
		firstName: "",
		lastName: "",
		businessName: "",
		instructions: "",
	},
	trackingHistory: [],
	trackingURL: "",
	status: ""
}