exports.STRATEGIES = {
	AUTO_CLOSEST_COURIER_TO_ME: "AUTO_CLOSEST_COURIER_TO_ME",
	AUTO_HIGHEST_RATED_COURIER: "AUTO_HIGHEST_RATED_COURIER",
}

exports.JOB_STATUS = {
	OFFERS_RECEIVED: "OFFERS_RECEIVED",
	JOB_AGREED: "JOB_AGREED",
	ARRIVED_AT_COLLECTION: "ARRIVED_AT_COLLECTION",
	COLLECTED: "COLLECTED",
	IN_PROGRESS: "IN_PROGRESS",
	ARRIVED_AT_DELIVERY: "ARRIVED_AT_DELIVERY",
	DELIVERED: "DELIVERED",
	COMPLETED_SUCCESSFULLY: "COMPLETED_SUCCESSFULLY",
	DELIVERY_ATTEMPT_FAILED: "DELIVERY_ATTEMPT_FAILED",
	NOT_AS_DESCRIBED: "NOT_AS_DESCRIBED",
	NO_RESPONSE: "NO_RESPONSE",
	ADMIN_CANCELLED: "ADMIN_CANCELLED",
	EXPIRED_WITHOUT_ACCEPTANCE: "EXPIRED_WITHOUT_ACCEPTANCE"
}

exports.CANCELLATION_REASONS = {
	NOT_AS_DESCRIBED: "Package type does not comply with the package type in the booking",
	NO_RESPONSE: "Courier received no answer from the pickup / dropoff address",
	ADMIN_CANCELLED: "A Street Stream admin needed to cancel the job. Contact secondsdelivery@gmail.com to enquire"
}

exports.PACKAGE_TYPES = [
	{
		id: 'PT1001',
		type: 'Envelope',
		size: 'Small',
		maxWeightKilograms: 0.25,
		maxWidthCentimetres: 25.0,
		maxHeightCentimetres: 15.0,
		maxDepthCentimetres: 1.0,
		groupOrder: 1,
		orderInGroup: 1,
		active: true,
		defaultTransportType: 'BICYCLE',
	},
	{
		id: 'PT1002',
		type: 'Envelope',
		size: 'Medium',
		maxWeightKilograms: 0.75,
		maxWidthCentimetres: 30.0,
		maxHeightCentimetres: 21.0,
		maxDepthCentimetres: 2.0,
		groupOrder: 1,
		orderInGroup: 2,
		active: true,
		defaultTransportType: 'BICYCLE',
	},
	{
		id: 'PT1003',
		type: 'Envelope',
		size: 'Large',
		maxWeightKilograms: 1.0,
		maxWidthCentimetres: 42.0,
		maxHeightCentimetres: 30.0,
		maxDepthCentimetres: 5.0,
		groupOrder: 1,
		orderInGroup: 3,
		active: true,
		defaultTransportType: 'BICYCLE',
	},
	{
		id: 'PT1004',
		type: 'Bag/Portfolio',
		size: 'Bag/Portfolio with a shoulder strap',
		maxWeightKilograms: 2.0,
		maxWidthCentimetres: 30.0,
		maxHeightCentimetres: 21.0,
		maxDepthCentimetres: 15.0,
		groupOrder: 2,
		orderInGroup: 1,
		active: true,
		defaultTransportType: 'BICYCLE',
	},
	{
		id: 'PT1005',
		type: 'Bag/Portfolio',
		size: 'Tube',
		maxWeightKilograms: 7.0,
		maxWidthCentimetres: 50.0,
		maxHeightCentimetres: 20.0,
		maxDepthCentimetres: 20.0,
		groupOrder: 2,
		orderInGroup: 2,
		active: true,
		defaultTransportType: 'BICYCLE',
	},
	{
		id: 'PT1006',
		type: 'Package',
		size: 'Small',
		maxWeightKilograms: 2.0,
		maxWidthCentimetres: 20.0,
		maxHeightCentimetres: 20.0,
		maxDepthCentimetres: 15.0,
		groupOrder: 3,
		orderInGroup: 1,
		active: true,
		defaultTransportType: 'BICYCLE',
	},
	{
		id: 'PT1007',
		type: 'Package',
		size: 'Medium',
		maxWeightKilograms: 7.0,
		maxWidthCentimetres: 25.0,
		maxHeightCentimetres: 25.0,
		maxDepthCentimetres: 20.0,
		groupOrder: 3,
		orderInGroup: 2,
		active: true,
		defaultTransportType: 'BICYCLE',
	},
	{
		id: 'PT1008',
		type: 'Package',
		size: 'Large',
		maxWeightKilograms: 15.0,
		maxWidthCentimetres: 50.0,
		maxHeightCentimetres: 35.0,
		maxDepthCentimetres: 28.0,
		groupOrder: 3,
		orderInGroup: 3,
		active: true,
		defaultTransportType: 'MOTORBIKE',
	},
	{
		id: 'PT1011',
		type: 'Bulky Item',
		size: 'Load for a large van',
		maxWeightKilograms: 1200.0,
		maxWidthCentimetres: 180.0,
		maxHeightCentimetres: 170.0,
		maxDepthCentimetres: 300.0,
		groupOrder: 4,
		orderInGroup: 3,
		active: true,
		defaultTransportType: 'LARGE_VAN_MESSENGER',
	},
	{
		id: 'PT1012',
		type: 'Pallet',
		size: 'Quarter',
		maxWeightKilograms: 250.0,
		maxWidthCentimetres: 120.0,
		maxHeightCentimetres: 100.0,
		maxDepthCentimetres: 80.0,
		groupOrder: 5,
		orderInGroup: 1,
		active: true,
		defaultTransportType: 'PALLET_CARRIER_MESSENGER',
	},
	{
		id: 'PT1013',
		type: 'Pallet',
		size: 'Half',
		maxWeightKilograms: 500.0,
		maxWidthCentimetres: 120.0,
		maxHeightCentimetres: 100.0,
		maxDepthCentimetres: 110.0,
		groupOrder: 5,
		orderInGroup: 2,
		active: true,
		defaultTransportType: 'PALLET_CARRIER_MESSENGER',
	},
	{
		id: 'PT1014',
		type: 'Pallet',
		size: 'Full',
		maxWeightKilograms: 1000.0,
		maxWidthCentimetres: 120.0,
		maxHeightCentimetres: 100.0,
		maxDepthCentimetres: 220.0,
		groupOrder: 5,
		orderInGroup: 3,
		active: true,
		defaultTransportType: 'PALLET_CARRIER_MESSENGER',
	},
	{
		id: 'PT1009',
		type: 'Bulky Item',
		size: 'Car Boot Load',
		maxWeightKilograms: 50.0,
		maxWidthCentimetres: 50.0,
		maxHeightCentimetres: 100.0,
		maxDepthCentimetres: 100.0,
		groupOrder: 4,
		orderInGroup: 1,
		active: true,
		defaultTransportType: 'CAR_AND_PARCEL_MESSENGER',
	},
	{
		id: 'PT1010',
		type: 'Bulky Item',
		size: 'Items for a small van',
		maxWeightKilograms: 500.0,
		maxWidthCentimetres: 70.0,
		maxHeightCentimetres: 170.0,
		maxDepthCentimetres: 120.0,
		groupOrder: 4,
		orderInGroup: 2,
		active: true,
		defaultTransportType: 'MEDIUM_VAN_MESSENGER',
	},
];