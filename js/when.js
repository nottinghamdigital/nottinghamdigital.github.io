(function () {
	var When = {
		FIRST: 1,
		SECOND: 2,
		THIRD: 3,
		FOURTH: 4,
		FIFTH: 5,

		MONDAY: 1,
		TUESDAY: 2,
		WEDNESDAY: 3,
		THURSDAY: 4,
		FRIDAY: 5,
		SATURDAY: 6,
		SUNDAY: 0,

		JANUARY: 0,
		FEBRUARY: 1,
		MARCH: 2,
		APRIL: 3,
		MAY: 4,
		JUNE: 5,
		JULY: 6,
		AUGUST: 7,
		SEPTEMBER: 8,
		OCTOBER: 9,
		NOVEMBER: 10,
		DECEMBER: 11,

		now: function now() {
			var now = new Date();
			return new Date(now.getFullYear(), now.getMonth(), now.getDate());
		},

		compare: function compare(date, ord, day) {
			if (date.getDate() <= (ord - 1) * 7) {
				return -7;
			} else if (date.getDate() > (ord) * 7) {
				return 7;
			}
			return date.getDay() - day;
		},

		is: function is(date, ord, day) {
			return When.compare(date, ord, day) == 0;
		},

		get: function get(ord, day, month, year) {
			var r = new Date(year, month, 1);
			var firstDay = r.getDay();
			var newDate = (day - firstDay + 7) % 7 + 1 + (7 * (ord - 1));
			r.setDate(newDate);
			return r;
		},

		next: function next(ord, day) {
			var now = When.now();
			thisMonth = When.get(ord, day, now.getMonth(), now.getFullYear());
			if (thisMonth < now) {
				var year = now.getFullYear();
				var month = now.getMonth() + 1;
				if (month == 12) {
					month = 0;
					year += 1;
				}
				return When.get(ord, day, month, year);
			}
			return thisMonth;
		},

		test: function test() {
			function assertEqual(value, expected) {
				if (typeof(value.getTime) == 'function' && typeof(expected.getTime) == 'function') {
					if (value.getTime() != expected.getTime()) {
						console.log('Expected: ' + expected + ', got ' + value);
					}
				} else if (value != expected) {
					console.log('Expected: ' + expected + ', got ' + value);
				}
			}

			When.now = function now() {
				return new Date(2011, 4, 19);
			};

			var now = When.now();
			assertEqual(now.getFullYear(), 2011);
			assertEqual(now.getMonth(), 4);
			assertEqual(now.getDate(), 19);
			assertEqual(now.getDay(), 4);

			assertEqual(When.is(new Date(2011, 5, 1), When.FIRST, When.WEDNESDAY), true);
			assertEqual(When.is(new Date(2011, 5, 7), When.FIRST, When.TUESDAY), true);
			assertEqual(When.is(new Date(2011, 5, 8), When.SECOND, When.WEDNESDAY), true);

			assertEqual(When.get(When.FIRST, When.WEDNESDAY, When.MAY, 2011), new Date(2011, When.MAY, 4));
			assertEqual(When.get(When.SECOND, When.WEDNESDAY, When.MAY, 2011), new Date(2011, When.MAY, 11));

			assertEqual(When.next(When.FIRST, When.WEDNESDAY), new Date(2011, 5, 1));
			assertEqual(When.next(When.SECOND, When.WEDNESDAY), new Date(2011, 5, 8));
			assertEqual(When.next(When.THIRD, When.WEDNESDAY), new Date(2011, 5, 15));
			assertEqual(When.next(When.FOURTH, When.WEDNESDAY), new Date(2011, 4, 25));
		}
	};

	this.When = When;
})();
