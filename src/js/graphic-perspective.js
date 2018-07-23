import Stickyfill from 'stickyfilljs';
import scrollama from 'scrollama';
import * as Annotate from 'd3-svg-annotation';
import cleanData from './clean-data';
import tooltip from './tooltip';

const MARGIN = { top: 20, bottom: 40, left: 50, right: 50 };
const FONT_SIZE = 12;
const PRINCE_ID = '57317';
const BEYONCE_LAST = '20160425';
const DATE_START = new Date(2016, 2, 1);
const DATE_END = new Date(2016, 3, 27);
const MIN_R = 4;
const MAX_R = 16;
const SEC = 1000;
const DURATION = SEC * 3;
const EASE = d3.easeCubicInOut;
const HEADER_HEIGHT = d3.select('header').node().offsetHeight;

let width = 0;
let height = 0;
let innerHeight = 0;
let peopleData = null;
let pageviewData = null;
let beyonceData = null;
let currentStep = 'context';
let hoverEnabled = false;

const $section = d3.select('#perspective');

const $article = $section.select('article');
const $step = $article.selectAll('.step');

const $figure = $section.select('figure');
const $chart = $figure.select('.figure__chart');
const $svg = $chart.select('svg');

const $gVis = $svg.select('.g-vis');
const $gAxis = $svg.select('.g-axis');
const $gVor = $svg.select('.g-voronoi');
const $people = $gVis.select('.people');

let $tip = null;

const scroller = scrollama();
const scrollerHover = scrollama();
const voronoi = d3.voronoi();

function filter({ name, value }) {
	// if (currentStep === 'compare') {
	// }
	const $person = $people.selectAll('.person');
	if (name) $person.classed('is-faded', d => !d[name].includes(value));
	else $person.classed('is-faded', false);
}

// helper functions
function getScaleX(data = beyonceData[0].pageviews) {
	// scales
	return d3
		.scaleTime()
		.domain(d3.extent(data, d => d.date))
		.nice()
		.range([0, width]);
}

function getScaleY(data = beyonceData[0].pageviews) {
	const maxY = d3.max(data, d => d.views_adjusted);

	return d3
		.scaleLinear()
		.domain([0, maxY])
		.nice()
		.range([height, 0]);
}

function getScaleR(data) {
	return d3
		.scaleSqrt()
		.domain(d3.extent(data, d => d.death_views_adjusted_2))
		.nice()
		.range([MIN_R, MAX_R]);
}

function getLine({ scaleX, scaleY }) {
	return d3
		.line()
		.x(d => scaleX(d.date))
		.y(d => scaleY(d.views_adjusted))
		.curve(d3.curveMonotoneX)
		.defined(d => d.views_adjusted);
}

function updateAxis({ scaleX, scaleY, dur, ticks = d3.timeMonth.every(1) }) {
	const axisY = d3
		.axisLeft(scaleY)
		.tickFormat((val, i) => {
			const formatted = d3.format('.2s')(val);
			const suffix = i === 6 ? ' adjusted pageviews' : '';
			return `${formatted}${suffix}`;
		})
		.tickSize(-(width + MARGIN.left))
		.tickPadding(MARGIN.left)
		.ticks(5);

	$gAxis
		.select('.axis--y')
		.transition()
		.duration(dur.slow)
		.ease(EASE)
		.call(axisY)
		.at('transform', `translate(${MARGIN.left}, ${MARGIN.top})`);

	$gAxis
		.selectAll('.axis--y text')
		.at('text-anchor', 'start')
		.at('y', -FONT_SIZE / 2);

	$gAxis
		.selectAll('.axis--y line')
		.at('transform', `translate(${-MARGIN.left}, 0)`);

	function multiFormat(date) {
		return (d3.timeYear(date) < date
			? d3.timeFormat('%b')
			: d3.timeFormat('%Y'))(date);
	}

	const axisX = d3
		.axisBottom(scaleX)
		.ticks(ticks)
		.tickSize(0)
		.tickPadding(0)
		.tickFormat(multiFormat);

	$gAxis
		.select('.axis--x')
		.transition()
		.duration(dur.slow)
		.ease(EASE)
		.call(axisX)
		.at(
			'transform',
			`translate(${MARGIN.left}, ${height + MARGIN.bottom - FONT_SIZE})`
		);
}

function resetLine($person, offset) {
	const $path = $person.selectAll('path');

	const totalLength = $path.node().getTotalLength();
	const dashOffset = offset ? totalLength - offset : totalLength;

	$path.at({
		'stroke-dasharray': `${totalLength} ${totalLength}`,
		'stroke-dashoffset': dashOffset
	});
}

function enterPerson($person) {
	$person.at('data-id', d => d.pageid);
	$person.append('path');
	$person.append('g.circles');

	$person
		.append('text.bg')
		.text(d => d.display)
		.at('x', 0)
		.at('y', 0)
		.at('text-anchor', 'middle')
		.at('alignment-baseline', 'baseline')
		.st('opacity', 0);

	$person
		.append('text.fg')
		.text(d => d.display)
		.at('x', 0)
		.at('y', 0)
		.at('text-anchor', 'middle')
		.at('alignment-baseline', 'baseline')
		.st('opacity', 0);
}

function exitPerson($person, dur) {
	// EXIT
	$person
		.exit()
		.transition()
		.duration(dur)
		.st('opacity', 0)
		.remove();
}

function enterCircles($person, { scaleX, scaleY, r = MIN_R }) {
	const $c = $person
		.select('.circles')
		.selectAll('circle')
		.data(
			d =>
				d.pageviews.filter(
					p =>
						['beyonce', PRINCE_ID].includes(p.pageid) || p.bin_death_index === 0
				),
			k => k.timestamp
		);

	const $enter = $c
		.enter()
		.append('circle')
		.classed('is-not-death-index', d => d.bin_death_index !== 0)
		.at({
			cx: 0,
			cy: 0,
			r
		})
		.at(
			'transform',
			d => `translate(${scaleX(d.date)}, ${scaleY(d.views_adjusted)})`
		);

	$enter
		.merge($c)
		.at('data-x', d => scaleX(d.date))
		.at('data-y', d => scaleY(d.views_adjusted));

	$c.exit().remove();
}

function updatePath($person, { scaleX, scaleY, render = true }) {
	const line = getLine({ scaleX, scaleY });
	if ($person.datum().pageviews.length > 1) {
		$person.selectAll('path').data(d => [d.pageviews]);
		if (render) $person.selectAll('path').at('d', line);
	}
}

function trimPageviews(pageviews, { start = -1, end = 0 }) {
	return pageviews
		.map(p => ({ ...p }))
		.filter(p => p.bin_death_index >= start && p.bin_death_index <= end);
}

function findPrinceStart(date) {
	const data = peopleData.find(d => d.pageid === PRINCE_ID).pageviews;

	const views = data.map((d, i) => ({ i, date: d.date, diff: d.date - date }));
	const filtered = views.filter(d => d.diff > 0);
	return data[filtered[0].i].bin_death_index;
}

function getDuration({ leave, reverse }) {
	let factor = 1;
	if (leave) factor = 0;
	else if (reverse) factor = 0.33;
	const slow = DURATION * factor;
	const medium = Math.floor(slow * 0.33);
	const fast = Math.floor(slow * 0.1);
	return {
		slow,
		medium,
		fast
	};
}

function handleVorEnter(d) {
	if (hoverEnabled && currentStep === 'compare') {
		const { pageid } = d.data;
		const datum = peopleData.find(v => v.pageid === pageid);
		$people.selectAll('.person').classed('is-active', v => v.pageid === pageid);
		const $person = d3.select(`[data-id='${pageid}'`);

		if ($person.size()) {
			$person.raise();
			const $circle = $person
				.selectAll('circle')
				.filter(v => v.bin_death_index === 0);
			const x = +$circle.at('data-x') + MARGIN.left;
			const y = +$circle.at('data-y') + MARGIN.top;

			const pos = { x, y };
			tooltip.show({ el: $tip, d: datum, pos });
		}
	}
}

function createAnnotation({ scaleX, scaleY, annoData, dur = 0, delay = 0 }) {
	$gVis.select('.g-annotation').remove();
	const $anno = $gVis.append('g.g-annotation');
	$anno.st('opacity', 0);

	// const type = Annotate.annotationCustomType(Annotate.annotationLabel, {
	// 	className: 'custom',
	// 	connector: { type: 'line' },
	// 	note: {
	// 		align: 'middle',
	// 		orientation: 'leftRight'
	// 	}
	// });

	const type = Annotate.annotationCustomType(Annotate.annotationCalloutCircle, {
		className: 'custom',
		connector: { type: 'line' },
		note: {
			lineType: 'horizontal',
			align: 'dynamic'
		}
	});

	const annotations = annoData.map(d => ({
		note: {
			title: d.title,
			padding: d.padding,
			wrap: 120
		},
		data: { date: d.value.date, views_adjusted: d.value.views_adjusted },
		dx: d.dx,
		dy: d.dy,
		subject: {
			radius: d.r,
			radiusPadding: MIN_R
		}
	}));

	const makeAnnotations = Annotate.annotation()
		.type(type)
		.accessors({
			x: d => scaleX(d.date),
			y: d => scaleY(d.views_adjusted)
		})
		.annotations(annotations);

	$anno.call(makeAnnotations);
	$anno
		.transition()
		.duration(dur)
		.delay(delay)
		.ease(EASE)
		.st('opacity', 1);
}

// step render
const STEP = {
	context: ({ reverse, leave }) => {
		// console.log('context', { reverse, leave });
		const dur = getDuration({ leave, reverse });

		// DATA
		const data = beyonceData;

		// SCALE
		const scaleX = getScaleX();
		const scaleY = getScaleY();

		// AXIS
		updateAxis({ scaleX, scaleY, dur: { slow: 0 } });

		// PEOPLE
		const $person = $people.selectAll('.person').data(data, d => d.pageid);
		const $personEnter = $person
			.enter()
			.append('g.person')
			.call(enterPerson);
		const $personMerge = $personEnter.merge($person);
		$personMerge.call(updatePath, { scaleX, scaleY });
		$personMerge.call(enterCircles, { scaleX, scaleY });

		// highlight beyonce
		$personMerge.classed('is-highlight', true);

		$personMerge
			.selectAll('circle')
			.transition()
			.duration(dur.fast)
			.ease(EASE)
			.at('r', MIN_R)
			.st('stroke-width', MIN_R / 2);

		// ANNOTATION
		createAnnotation({ scaleX, scaleY, annoData: [] });

		exitPerson($person, dur.fast);
	},
	lemonade: ({ reverse, leave }) => {
		// console.log('lemonade', { reverse, leave });
		if (!reverse && !leave) STEP.context({ leave: true });
		const dur = getDuration({ leave, reverse });

		// DATA
		const data = beyonceData;
		const annoData = [
			{
				value: data[0].pageviews[data[0].pageviews.length - 1],
				title: 'Lemonade is released',
				padding: FONT_SIZE * 0.5,
				dx: -50,
				dy: 50,
				r: MAX_R * 1.25
			}
		];

		// SCALE
		const scaleX = getScaleX();
		const scaleY = getScaleY();

		// AXIS
		updateAxis({ scaleX, scaleY, dur: { slow: 0 } });

		// PEOPLE
		const $person = $people.selectAll('.person').data(data, d => d.pageid);
		const $personEnter = $person
			.enter()
			.append('g.person')
			.call(enterPerson);
		const $personMerge = $personEnter.merge($person);
		$personMerge.call(updatePath, { scaleX, scaleY });
		$personMerge.call(enterCircles, { scaleX, scaleY });

		// highlight beyonce
		$personMerge.classed('is-highlight', true);
		$personMerge
			.selectAll('circle')
			.filter(d => d.timestamp === BEYONCE_LAST)
			.transition()
			.duration(dur.fast)
			.ease(EASE)
			.at('r', MAX_R)
			.st('stroke-width', MAX_R / 2)
			.at(
				'transform',
				d => `translate(${scaleX(d.date)}, ${scaleY(d.views_adjusted)})`
			);

		// ANNOTATION
		createAnnotation({ scaleX, scaleY, annoData, dur: dur.fast });

		exitPerson($person, dur.fast);
	},
	'prince-before': ({ reverse, leave }) => {
		// console.log('prince-before', { reverse, leave });
		if (!reverse && !leave) STEP.lemonade({ leave: true });

		const dur = getDuration({ leave, reverse });

		// DATA
		const start = findPrinceStart(DATE_START);
		const data = peopleData
			.filter(d => d.pageid === PRINCE_ID)
			.map(d => ({
				...d,
				pageviews: trimPageviews(d.pageviews, { start, end: -1 })
			}))
			.concat(beyonceData);

		// SCALE
		const scaleX = getScaleX();
		const scaleY = getScaleY();

		// AXIS
		updateAxis({ scaleX, scaleY, dur });

		// PEOPLE
		const $person = $people.selectAll('.person').data(data, d => d.pageid);

		const $personEnter = $person
			.enter()
			.append('g.person')
			.call(enterPerson);
		const $personMerge = $personEnter.merge($person);
		$personMerge.call(enterCircles, { scaleX, scaleY, r: MIN_R });
		$personMerge.call(updatePath, { scaleX, scaleY, render: !reverse });

		// TRANSITION
		const line = getLine({ scaleX, scaleY });
		if (reverse) {
			$personMerge
				.selectAll('path')
				.transition()
				.duration(dur.slow)
				.ease(EASE)
				.at('d', line)
				.at('stroke-dashoffset', 0)
				.st('opacity', 1);

			$personMerge
				.selectAll('circle')
				.transition()
				.duration(dur.slow)
				.ease(EASE)
				.st('opacity', 1)
				.at('r', MIN_R)
				.at(
					'transform',
					d => `translate(${scaleX(d.date)}, ${scaleY(d.views_adjusted)})`
				);
		} else {
			const $prince = $personMerge.filter(d => d.pageid === PRINCE_ID);
			const $bey = $personMerge.filter(d => d.pageid === 'beyonce');
			$prince.call(resetLine);
			$prince
				.selectAll('path')
				.transition()
				.duration(dur.slow)
				.ease(EASE)
				.at('stroke-dashoffset', 0);

			$prince
				.selectAll('circle')
				.at('r', 0)
				.transition()
				.duration(dur.fast)
				.delay((d, i, n) => dur.slow * EASE(i / n.length))
				.ease(EASE)
				.at('r', d => (d.bin_death_index === 0 ? MAX_R : MIN_R))
				.st(
					'stroke-width',
					d => (d.bin_death_index === 0 ? MAX_R / 2 : MIN_R / 2)
				);

			$bey
				.selectAll('circle')
				.transition()
				.duration(dur.fast)
				.ease(EASE)
				.at('r', MIN_R)
				.st('stroke-width', MIN_R / 2);
		}

		// ANNOTATION
		createAnnotation({ scaleX, scaleY, annoData: [] });

		// highlight prince
		$personMerge.classed('is-highlight', d => d.pageid === PRINCE_ID);
		$personMerge.filter(d => d.pageid === PRINCE_ID).raise();

		exitPerson($person, dur.fast);
	},
	'prince-spike': ({ reverse, leave }) => {
		// console.log('prince-spike', { reverse, leave });
		if (!reverse && !leave) STEP['prince-before']({ leave: true });

		const dur = getDuration({ leave, reverse });

		// DATA
		const start = findPrinceStart(DATE_START);
		const data = peopleData
			.filter(d => d.pageid === PRINCE_ID)
			.map(d => ({
				...d,
				pageviews: trimPageviews(d.pageviews, { start, end: 0 })
			}))
			.concat(beyonceData);

		// SCALE
		const princeViews = data.find(d => d.pageid === PRINCE_ID).pageviews;
		const scaleX = getScaleX();
		const scaleY = getScaleY(princeViews);

		// AXIS
		updateAxis({ scaleX, scaleY, dur });

		// PEOPLE
		const $person = $people.selectAll('.person').data(data, d => d.pageid);
		const $personEnter = $person
			.enter()
			.append('g.person')
			.call(enterPerson);
		const $personMerge = $personEnter.merge($person);

		// TRANSITION
		const addSpike = () => {
			const $prince = $personMerge.filter(d => d.pageid === PRINCE_ID);

			const previousLen = $prince
				.selectAll('path')
				.node()
				.getTotalLength();

			$prince.call(updatePath, { scaleX, scaleY });
			$prince.call(enterCircles, { scaleX, scaleY, r: 0 });

			if (!leave && !reverse) $prince.call(resetLine, previousLen);

			$prince
				.selectAll('path')
				.transition()
				.duration(leave ? 0 : dur.slow)
				.ease(EASE)
				.at('stroke-dashoffset', 0);

			$prince
				.selectAll('circle')
				.transition()
				.duration(dur.medium)
				.delay(dur.slow)
				.ease(EASE)
				.at('r', d => (d.bin_death_index === 0 ? MAX_R : MIN_R))
				.st(
					'stroke-width',
					d => (d.bin_death_index === 0 ? MAX_R / 2 : MIN_R / 2)
				);
		};

		const line = getLine({ scaleX, scaleY });

		if (reverse) {
			$personMerge.call(enterCircles, { scaleX, scaleY, r: 0 });
			$personMerge.call(updatePath, { scaleX, scaleY, render: !reverse });
			$personMerge
				.selectAll('path')
				.at('d', line)
				.at('opacity', 0)
				.at('stroke-dashoffset', 0)
				.at('stroke-dasharray', '0 0')
				.transition()
				.duration(dur.fast)
				.delay(dur.slow)
				.ease(EASE)
				.st('opacity', 1);
			$personMerge
				.selectAll('circle')
				.transition()
				.duration(dur.slow)
				.delay(d => (d.pageid === 'beyonce' ? dur.slow : 0))
				.ease(EASE)
				.st('opacity', 1)
				.at('r', d => (d.bin_death_index === 0 ? MAX_R : MIN_R))
				.at(
					'transform',
					d => `translate(${scaleX(d.date)}, ${scaleY(d.views_adjusted)})`
				)
				.st(
					'stroke-width',
					d => (d.bin_death_index === 0 ? MAX_R / 2 : MIN_R / 2)
				);
		} else {
			$personMerge
				.selectAll('path')
				.transition()
				.duration(dur.slow)
				.ease(EASE)
				.at('d', line)
				.st('opacity', 1)
				.on('end', d => {
					if (d[0].pageid === PRINCE_ID && !leave) addSpike(true);
				});

			$personMerge
				.selectAll('circle')
				.transition()
				.duration(dur.slow)
				.ease(EASE)
				.st('opacity', 1)
				.at(
					'transform',
					d => `translate(${scaleX(d.date)}, ${scaleY(d.views_adjusted)})`
				)
				.st(
					'stroke-width',
					d => (d.bin_death_index === 0 ? MAX_R / 2 : MIN_R / 2)
				);
		}

		$personMerge
			.selectAll('text')
			.transition()
			.duration(dur.fast)
			.ease(EASE)
			.st('opacity', 0);

		// highlight prince
		$personMerge.classed('is-highlight', d => d.pageid === PRINCE_ID);
		$personMerge.filter(d => d.pageid === PRINCE_ID).raise();

		// ANNOTATION
		createAnnotation({ scaleX, scaleY, annoData: [] });

		// EXIT
		exitPerson($person);
		// LEAVE
		if (leave && !reverse) addSpike();
	},
	others: ({ reverse, leave }) => {
		// console.log('others', { reverse, leave });
		if (!reverse && !leave) STEP['prince-spike']({ leave: true });

		const dur = getDuration({ leave, reverse });

		// DATA
		const data = peopleData.map(d => ({
			...d,
			pageviews: trimPageviews(d.pageviews, { start: 0, end: 0 })
		}));

		// SCALE
		data.sort((a, b) =>
			d3.descending(a.death_views_adjusted_2, b.death_views_adjusted_2)
		);

		const scaleX = getScaleX(pageviewData);
		const scaleY = getScaleY(pageviewData);
		const scaleR = getScaleR(data);
		// AXIS
		updateAxis({ scaleX, scaleY, dur, ticks: null });
		// PEOPLE
		data.sort((a, b) =>
			d3.ascending(+a.timestamp_of_death, +b.timestamp_of_death)
		);
		const $person = $people.selectAll('.person').data(data, d => d.pageid);
		const $personEnter = $person
			.enter()
			.append('g.person')
			.call(enterPerson);
		// PEOPLE

		const addOthers = () => {
			const $personMerge = $personEnter.merge($person);
			$personMerge.call(enterCircles, { scaleX, scaleY, r: 0 });
			$personMerge
				.selectAll('circle')
				.classed('is-active', false)
				.transition()
				.duration(dur.medium)
				.delay(d => {
					const { index } = peopleData.find(p => p.pageid === d.pageid);
					return dur.slow * (index / peopleData.length);
				})
				.ease(EASE)
				.at('r', d => scaleR(d.views_adjusted))
				.at('stroke-width', MIN_R / 2);

			$personMerge
				.selectAll('text')
				.at('transform', d => {
					const x = scaleX(d.pageviews[0].date);
					const y = scaleY(d.pageviews[0].views_adjusted);
					const r = scaleR(d.pageviews[0].views_adjusted * 1.5);
					return `translate(${x}, ${y - r})`;
				})
				.transition()
				.duration(dur.medium)
				.delay(d => {
					if (reverse) return 0;
					const { index } = peopleData.find(p => p.pageid === d.pageid);
					return dur.slow * (index / peopleData.length);
				})
				.ease(EASE)
				.st('opacity', d => (d.perspective_show ? 1 : 0));

			$personMerge.filter(d => d.perspective_show).raise();
			$personMerge
				.selectAll('.is-not-death-index')
				.classed('is-transparent', true);
		};

		const line = getLine({ scaleX, scaleY });
		$person
			.selectAll('path')
			.transition()
			.duration(dur.fast)
			.ease(EASE)
			.st('opacity', 0)
			.on('end', (d, i, n) => d3.select(n[i]).at('d', line));

		$person
			.selectAll('circle')
			.transition()
			.duration(reverse ? 0 : dur.medium)
			.ease(EASE)
			.st('opacity', d => (d.bin_death_index === 0 ? 1 : 0))
			.at(
				'transform',
				d => `translate(${scaleX(d.date)}, ${scaleY(d.views_adjusted)})`
			)
			.on('end', d => {
				if (d && d.pageid === PRINCE_ID && !leave) addOthers();
			});
		// highlight prince
		$person.classed('is-highlight', false);

		// ANNOTATION
		createAnnotation({ scaleX, scaleY, annoData: [] });

		exitPerson($person, dur.fast);

		// LEAVE
		if (leave && !reverse) {
			addOthers();
		}
	},
	compare: ({ reverse, leave }) => {
		// console.log('compare', { reverse, leave });
		if (!reverse && !leave) STEP.others({ leave: true });
		const dur = getDuration({ leave, reverse });

		// DATA
		const data = peopleData.map(d => ({
			...d,
			pageviews: trimPageviews(d.pageviews, { start: -50, end: 0 })
		}));

		const median = 251794497 * 2;
		const annoData = [
			{
				value: {
					date: new Date(2016, 5, 20),
					views_adjusted: (1354216 / 500201369) * median
				},
				title: 'LeBron James (NBA Finals)',
				padding: 0,
				dx: Math.floor(width * 0.01),
				dy: -Math.floor(width * 0.07),
				r: MAX_R / 2
			},
			{
				value: {
					date: new Date(2017, 0, 20),
					views_adjusted: (3635774 / 538696302) * median
				},
				title: 'Donald Trump (inauguration)',
				padding: 0,
				dx: Math.floor(width * 0.02),
				dy: -Math.floor(width * 0.03),
				r: MAX_R / 2
			},
			{
				value: {
					date: new Date(2018, 4, 19),
					views_adjusted: (4503531 / 530076204) * median
				},
				title: ' Meghan Markle (royal wedding)',
				padding: 0,
				dx: -Math.floor(width * 0.05),
				dy: -Math.floor(width * 0.05),
				r: MAX_R / 2
			}
		];

		// SCALE
		data.sort((a, b) =>
			d3.descending(a.death_views_adjusted_2, b.death_views_adjusted_2)
		);

		const scaleX = getScaleX(pageviewData);
		const scaleY = getScaleY(pageviewData);

		// AXIS
		updateAxis({ scaleX, scaleY, dur, ticks: null });

		// PEOPLE
		data.sort((a, b) =>
			d3.ascending(+a.timestamp_of_death, +b.timestamp_of_death)
		);

		const $person = $people.selectAll('.person').data(data, d => d.pageid);
		$person
			.enter()
			.append('g.person')
			.call(enterPerson);

		// PEOPLE
		$person
			.selectAll('path')
			.transition()
			.duration(dur.slow)
			.ease(EASE)
			.st('opacity', 0);

		$person
			.selectAll('circle')
			.transition()
			.duration(dur.slow)
			.ease(EASE)
			.st('opacity', d => (d.bin_death_index === 0 ? 1 : 0))
			.at(
				'transform',
				d => `translate(${scaleX(d.date)}, ${scaleY(d.views_adjusted)})`
			);

		$person
			.selectAll('text')
			.transition()
			.duration(dur.fast)
			.ease(EASE)
			.st('opacity', 0);

		// highlight prince
		$person.classed('is-highlight', false);

		// EXIT BEYONCE
		$person
			.exit()
			.transition()
			.duration(dur.fast)
			.st('opacity', 0)
			.remove();

		// LEAVE
		if (leave && !reverse) {
			// ANNOTATION
			createAnnotation({ scaleX, scaleY, annoData: [] });
		} else {
			// ANNOTATION
			createAnnotation({ scaleX, scaleY, annoData });
		}

		// VORONOI
		voronoi
			.x(d => scaleX(d.date))
			.y(d => scaleY(d.views_adjusted))
			.extent([
				[-MARGIN.left, -MARGIN.top],
				[width + MARGIN.left, height + MARGIN.top]
			]);

		const $vorPath = $gVor.selectAll('path');
		const vorData = data.map(d =>
			d.pageviews.find(v => v.bin_death_index === 0)
		);
		const polygons = voronoi.polygons(vorData);

		$vorPath
			.data(polygons)
			.enter()
			.append('path')
			.on('mouseenter', handleVorEnter)
			.merge($vorPath)
			.at('d', d => (d ? `M${d.join('L')}Z` : null));

		exitPerson($person, dur.fast);
	}
};

function updateDimensions() {
	innerHeight = window.innerHeight;
	height = Math.floor(innerHeight * 0.8) - MARGIN.top - MARGIN.bottom;
	width = $chart.node().offsetWidth - MARGIN.left - MARGIN.right;
}

function updateStep({ reverse = true, leave = false }) {
	// console.log({ currentStep, reverse, leave });
	if (STEP[currentStep]) STEP[currentStep]({ reverse, leave });
}

function resize() {
	updateDimensions();

	$figure.st({
		height: innerHeight,
		top: HEADER_HEIGHT,
		'padding-bottom': HEADER_HEIGHT
	});

	$svg.at({
		width: width + MARGIN.left + MARGIN.right,
		height: height + MARGIN.top + MARGIN.bottom
	});

	$gVis.at('transform', `translate(${MARGIN.left}, ${MARGIN.top})`);
	$gVor.at('transform', `translate(${MARGIN.left}, ${MARGIN.top})`);

	// step height and padding
	const stepCount = $step.size();
	$step.st('padding-bottom', innerHeight);
	$step.filter((d, i) => i === 0).st('margin-top', -innerHeight * 0.67);
	$step
		.filter((d, i) => i === stepCount - 1)
		.st('padding-bottom', innerHeight * 0.9);

	$article.select('.step-hover').st('padding-bottom', innerHeight * 0.4);

	scroller.resize();
	// scrollerHover.resize();
	updateStep({ reverse: false, leave: true });
}

function handleStepEnter({ element, index, direction }) {
	// console.log({ step: 'enter', index, element, direction });
	currentStep = d3.select(element).at('data-step');
	updateStep({ reverse: direction === 'up' });
}

function handleHoverEnter() {
	hoverEnabled = true;
	$chart.classed('is-hover', true);
	$article.classed('is-disabled', true);
}

function handleHoverExit() {
	hoverEnabled = false;
	$chart.classed('is-hover', false);
	$article.classed('is-disabled', false);
	tooltip.hide($tip);
}

function setupScroller() {
	Stickyfill.add($figure.node());

	scroller
		.setup({
			step: '#perspective article .step',
			offset: 0.99
		})
		.onStepEnter(handleStepEnter);

	scrollerHover
		.setup({
			step: '#perspective article .step-hover',
			offset: 1
		})
		.onStepEnter(handleHoverEnter)
		.onStepExit(handleHoverExit);
}

function setupTooltip() {
	$tip = tooltip.init({ container: $chart });
	$svg.on('mouseleave', () => {
		tooltip.hide($tip);
	});
}

function loadData(people) {
	return new Promise((resolve, reject) => {
		const filenames = ['perspective', 'beyonce'];
		const filepaths = filenames.map(f => `assets/data/${f}.csv`);
		d3.loadData(...filepaths, (err, response) => {
			if (err) reject(err);
			pageviewData = cleanData.pageview(response[0]);
			peopleData = people.map(d => ({
				...d,
				pageviews: pageviewData.filter(p => p.pageid === d.pageid)
			}));
			const beyoncePageviews = cleanData.pageview(response[1]);
			beyonceData = [
				{
					pageid: 'beyonce',
					pageviews: beyoncePageviews.filter(
						d => d.date >= DATE_START && d.date < DATE_END
					)
				}
			];

			resolve();
		});
	});
}

function test() {
	handleHoverEnter();
	let i = 0;
	const s = [
		'context',
		'lemonade',
		'prince-before',
		'prince-spike',
		'others',
		'compare'
	];

	window.addEventListener('keyup', e => {
		const dir = e.key === 'ArrowLeft' ? -1 : 1;
		i += dir;
		i = Math.min(Math.max(0, i), s.length - 1);
		currentStep = s[i];
		updateStep({ reverse: dir === -1, leave: false });
	});
}

function init(people) {
	loadData(people).then(() => {
		resize();
		setupScroller();
		setupTooltip();
		// test();
	});
}

export default { init, resize, filter };
