// All site copy and business facts live here. Edit, then run `node tools/build/build.mjs`.
// Facts marked CONFIRM in README.md came from public listings and his old site, not from the client.

export const business = {
  name: 'Corporate Cleaning Solutions',
  legalName: 'Corporate Cleaning Solutions (Qld) Pty Ltd',
  url: 'https://corporatecleaningsolutions.com.au',
  founded: '1978',
  phone: { display: '0410 689 872', href: 'tel:+61410689872', intl: '+61 410 689 872' },
  email: 'justin@corporatecleaningsolutions.com.au',
  address: {
    street: '19 Bracken Street',
    locality: 'Moorooka',
    region: 'QLD',
    postcode: '4105',
  },
  schools: 'nine', // CONFIRM: his old site says 8 in one place and 9 in another
};

export const nav = [
  { href: '/private-school-cleaning/', label: 'Schools' },
  { href: '/builders-cleans/', label: 'Builders’ cleans' },
  { href: '/commercial-cleaning/', label: 'Commercial' },
  { href: '/areas/', label: 'Areas' },
  { href: '/contact/', label: 'Contact' },
];

export const services = [
  {
    id: 'schools',
    href: '/private-school-cleaning/',
    name: 'Private school cleaning',
    short: 'Private schools',
    blurb: 'Classrooms, toilet blocks, halls and staff areas cleaned every day during term. The heavy floor work gets done in the holidays, while the buildings are empty.',
  },
  {
    id: 'builders',
    href: '/builders-cleans/',
    name: 'Builders’ cleans',
    short: 'Builders’ cleans',
    blurb: 'Cement dust, paint marks and site rubbish cleared, then glass, fittings and floors detailed until the building is ready to hand over.',
  },
  {
    id: 'commercial',
    href: '/commercial-cleaning/',
    name: 'Commercial & body corporate cleaning',
    short: 'Commercial & body corporate',
    blurb: 'Contract cleaning for small and medium commercial buildings and body corporate common areas, with specialist floor and glass work done by the same team.',
  },
];

export const specialist = [
  { name: 'Glass cleaning', text: 'Windows, partitions, entry doors and balustrades, inside and out.' },
  { name: 'Specialist tile cleaning', text: 'Deep cleaning for tiles and grout that a mop no longer shifts.' },
  { name: 'Carpet steam cleaning', text: 'Hot-water extraction for offices, corridors, staff rooms and libraries.' },
  { name: 'Scrubbing', text: 'Machine scrubbing for hard floors in high-traffic areas.' },
  { name: 'Vinyl stripping & sealing', text: 'All types of vinyl. Old sealer and ground-in dirt stripped back, then resealed.' },
  { name: 'Pressure cleaning', text: 'Paths, entries, car parks, bin areas and outdoor courts.' },
];

// Region ids match the map pipeline (tools/maps) and footage pipeline (tools/footage).
export const regions = [
  {
    id: 'cbd-valley',
    name: 'CBD & Valley',
    where: 'in the CBD and the Valley', // completes 'Cleaning …'
    long: 'Brisbane CBD, Spring Hill, Fortitude Valley, Newstead and Bowen Hills',
    suburbs: ['Brisbane City', 'Spring Hill', 'Fortitude Valley', 'Newstead', 'Bowen Hills'],
    title: 'Commercial Cleaning in the Brisbane CBD & Fortitude Valley',
    h1: 'Commercial cleaning in the Brisbane CBD and the Valley',
    description: 'Contract cleaning for small and medium commercial buildings and builders’ cleans in the Brisbane CBD, Spring Hill, Fortitude Valley, Newstead and Bowen Hills.',
    lede: 'Offices, mixed-use buildings and new construction in the inner north, cleaned by a family business that has worked in Brisbane since 1978.',
    copy: [
      'The CBD is Queensland’s biggest office market, and Spring Hill, the Valley, Newstead and Bowen Hills keep adding to it. We focus on the small and medium buildings between the towers: older commercial buildings in Spring Hill, mixed-use buildings in the Valley, and offices where the cleaning contract is still decided by someone who walks the floor.',
      'Newstead and Bowen Hills have been under construction for years, and every new building there needs a builders’ clean before handover. It’s also where we introduced ourselves to Brisbane’s building industry, as a platinum sponsor at an industry event in Newstead.',
    ],
    focus: {
      commercial: 'Offices and commercial floors from Spring Hill to the Valley, plus glass and carpet work between regular cleans.',
      builders: 'Rough, final and touch-up cleans for new buildings in Newstead and Bowen Hills.',
      schools: 'Inner-city independent schools, cleaned daily during term with floor work in the holidays.',
    },
    order: ['commercial', 'builders', 'schools'],
    near: ['south-brisbane', 'northside'],
  },
  {
    id: 'southside',
    name: 'Southside',
    where: 'on the southside', // completes 'Cleaning …'
    long: 'Moorooka, Annerley, Yeronga, Tarragindi, Salisbury and Rocklea',
    suburbs: ['Moorooka', 'Annerley', 'Yeronga', 'Tarragindi', 'Salisbury', 'Rocklea'],
    title: 'Commercial & School Cleaning in Moorooka & Brisbane’s Southside',
    h1: 'Commercial and school cleaning on Brisbane’s southside',
    description: 'Our home ground. Commercial, industrial-floor, school and builders’ cleaning in Moorooka, Annerley, Yeronga, Tarragindi, Salisbury and Rocklea.',
    lede: 'This is home. Our base is on Bracken Street in Moorooka, so the southside is never far away.',
    copy: [
      'The southside mixes busy road strips with quiet streets: shops and offices along Beaudesert Road and Ipswich Road, light industry and warehouses through Rocklea and Salisbury, and churches, schools and community buildings across Annerley, Yeronga and Tarragindi.',
      'Warehouse and workshop floors are where machine scrubbing and pressure cleaning earn their keep. Older vinyl in halls and community buildings comes up well with a proper strip and seal.',
    ],
    focus: {
      commercial: 'Shops, offices and light-industrial premises along Beaudesert Road, Ipswich Road and through Rocklea and Salisbury.',
      schools: 'Schools and church buildings in Annerley, Yeronga and Tarragindi, minutes from our base.',
      builders: 'Builders’ cleans for new commercial and residential buildings across the southside.',
    },
    order: ['commercial', 'schools', 'builders'],
    near: ['south-brisbane', 'eastside', 'western-suburbs'],
  },
  {
    id: 'south-brisbane',
    name: 'South Brisbane & Gabba',
    where: 'in South Brisbane and the Gabba', // completes 'Cleaning …'
    long: 'South Brisbane, West End, Highgate Hill, Woolloongabba and Kangaroo Point',
    suburbs: ['South Brisbane', 'West End', 'Highgate Hill', 'Woolloongabba', 'Kangaroo Point'],
    title: 'Commercial & Body Corporate Cleaning in South Brisbane & Woolloongabba',
    h1: 'Commercial and body corporate cleaning in South Brisbane and the Gabba',
    description: 'Body corporate common areas, commercial buildings and builders’ cleans in South Brisbane, West End, Highgate Hill, Woolloongabba and Kangaroo Point.',
    lede: 'Just across the river from the CBD, this is one of Brisbane’s densest areas for apartments, offices and new construction.',
    copy: [
      'Every apartment building in South Brisbane, West End and Kangaroo Point has common areas: foyers, lifts, stairwells, car parks and bin rooms that a body corporate needs kept clean every week. We look after those, plus the specialist work like pressure cleaning car parks and steam cleaning carpeted corridors.',
      'Woolloongabba is changing fast around the new Cross River Rail station. New buildings need builders’ cleans, and we can take a building from rough clean through to handover.',
    ],
    focus: {
      commercial: 'Body corporate common areas and commercial buildings across South Brisbane, West End and Kangaroo Point.',
      builders: 'Builders’ cleans for the new buildings going up around Woolloongabba.',
      schools: 'Independent schools close to the city, cleaned daily during term.',
    },
    order: ['commercial', 'builders', 'schools'],
    near: ['cbd-valley', 'eastside', 'southside'],
  },
  {
    id: 'western-suburbs',
    name: 'Western Suburbs',
    where: 'in the western suburbs', // completes 'Cleaning …'
    long: 'Toowong, Auchenflower, St Lucia, Taringa and Indooroopilly',
    suburbs: ['Toowong', 'Auchenflower', 'St Lucia', 'Taringa', 'Indooroopilly'],
    title: 'School & Commercial Cleaning in Toowong, St Lucia & Indooroopilly',
    h1: 'School and commercial cleaning in Brisbane’s western suburbs',
    description: 'Private school cleaning, commercial cleaning and specialist floor care in Toowong, Auchenflower, St Lucia, Taringa and Indooroopilly.',
    lede: 'Between the river bends at St Lucia and Indooroopilly: well-known schools, a university, a major hospital and busy shopping centres.',
    copy: [
      'The western suburbs are established, and their buildings show it. Many schools, medical suites and offices here still have their original vinyl and tile floors, and those floors look years younger after a strip and seal or a specialist tile clean.',
      'Schools are one of our three specialties, so the area suits us well: daily cleaning during term, then the deep floor work during the holidays while the classrooms are empty.',
    ],
    focus: {
      schools: 'Independent schools from Toowong to Indooroopilly, cleaned daily during term with floor programs in the holidays.',
      commercial: 'Offices and professional suites around Toowong, Auchenflower and Indooroopilly.',
      builders: 'Builders’ cleans for new buildings and refurbishments.',
    },
    order: ['schools', 'commercial', 'builders'],
    near: ['cbd-valley', 'south-brisbane', 'southside'],
  },
  {
    id: 'northside',
    name: 'Northside',
    where: 'in the inner northside', // completes 'Cleaning …'
    long: 'Albion, Ascot, Hamilton, Clayfield and Hendra',
    suburbs: ['Albion', 'Ascot', 'Hamilton', 'Clayfield', 'Hendra'],
    title: 'Commercial, School & Builders’ Cleaning in Ascot, Hamilton & Clayfield',
    h1: 'Commercial, school and builders’ cleaning in Ascot, Hamilton and Clayfield',
    description: 'Builders’ cleans, private school cleaning and commercial cleaning in Albion, Ascot, Hamilton, Clayfield and Hendra.',
    lede: 'Brisbane’s racing suburbs. Eagle Farm and Doomben racecourses sit in Ascot, and Racecourse Road runs down to the river at Hamilton.',
    copy: [
      'Along the river, Hamilton’s Northshore and Portside have filled with new apartments and commercial buildings, and every one needed a builders’ clean before anyone moved in. Behind them, Clayfield, Ascot and Hendra are home to independent schools, churches and professional suites.',
      'Albion rounds out the area, with older commercial buildings alongside newer development close to the station.',
    ],
    focus: {
      builders: 'Builders’ cleans for new apartments and commercial buildings at Hamilton Northshore and Portside.',
      schools: 'Independent schools in Clayfield, Ascot and Hendra, cleaned daily during term.',
      commercial: 'Shops, offices and professional suites along Racecourse Road and around Albion.',
    },
    order: ['builders', 'schools', 'commercial'],
    near: ['cbd-valley', 'south-brisbane'],
  },
  {
    id: 'eastside',
    name: 'Eastside',
    where: 'in the inner east', // completes 'Cleaning …'
    long: 'East Brisbane, Coorparoo, Greenslopes, Camp Hill and Carina',
    suburbs: ['East Brisbane', 'Coorparoo', 'Greenslopes', 'Camp Hill', 'Carina'],
    title: 'School & Commercial Cleaning in Coorparoo, Camp Hill & Brisbane’s East',
    h1: 'School and commercial cleaning in Coorparoo, Camp Hill and Brisbane’s east',
    description: 'Private school, commercial and body corporate cleaning in East Brisbane, Coorparoo, Greenslopes, Camp Hill and Carina.',
    lede: 'The east runs out along Old Cleveland Road and Logan Road, with schools, medical practices and shopping strips the whole way.',
    copy: [
      'Coorparoo’s junction has filled out with new apartments and shops, and Greenslopes is home to one of Brisbane’s major private hospitals, with medical suites clustered around it. Between them sit independent schools, churches and small offices, each with its own floors, glass and washrooms to look after.',
      'East Brisbane borders Woolloongabba, so this area joins straight onto our South Brisbane & Gabba area.',
    ],
    focus: {
      schools: 'Independent schools in Coorparoo, Camp Hill and East Brisbane, with holiday floor programs.',
      commercial: 'Medical suites, offices and body corporate common areas from Greenslopes to Carina.',
      builders: 'Builders’ cleans for new apartments and shops around Coorparoo.',
    },
    order: ['schools', 'commercial', 'builders'],
    near: ['south-brisbane', 'southside'],
  },
];

// Queensland school year, roughly. Private schools set their own dates, so months only.
export const schoolYear = [
  { label: 'Term 1', when: 'Late Jan – Mar', kind: 'term' },
  { label: 'Easter break', when: 'April', kind: 'break' },
  { label: 'Term 2', when: 'Apr – Jun', kind: 'term' },
  { label: 'Winter break', when: 'Late Jun – Jul', kind: 'break' },
  { label: 'Term 3', when: 'Jul – Sep', kind: 'term' },
  { label: 'Spring break', when: 'Late Sep – Oct', kind: 'break' },
  { label: 'Term 4', when: 'Oct – early Dec', kind: 'term' },
  { label: 'Summer break', when: 'Dec – Jan', kind: 'break' },
];
