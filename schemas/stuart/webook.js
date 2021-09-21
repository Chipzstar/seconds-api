const JOB = {
	id: 100171784,
	status: 'in_progress',
	comment: null,
	pickupAt: null,
	dropoffAt: null,
	createdAt: '2021-09-21T19:28:56.000+02:00',
	endedAt: null,
	transportType: {code: 'walk'},
	packageType: {code: 'small'},
	originComment: 'Ask Bobby',
	destinationComment: '2nd floor on the left',
	jobReference: 'TESTING',
	currentDelivery: {
		id: 100215436,
		trackingUrl: 'https://stuart.sandbox.followmy.delivery/100215436/a3837eba1c894f42635c5e566c4cfb42',
		clientReference: 'TESTING',
		driver: {
			status: 'busy',
			latitude: 51.54507065,
			longitude: 0.16058999,
			name: 'Terence Schimmel IV',
			firstname: 'Alexis',
			lastname: 'Marvin',
			phone: '+33903330923',
			picture_path_imgix: null,
			transportType: [Object]
		},
		status: 'almost_picking',
		transportType: {code: 'walk'},
		packageType: {code: 'small'},
		etaToDestination: '2021-09-21T20:50:12.000+02:00',
		etaToOrigin: '2021-09-21T19:31:37.000+02:00',
		cancellation: {canceledBy: null, reasonKey: null, comment: null}
	},
	deliveries: [{id: 100215436, clientReference: 'TESTING'}]
}