// The same source data and explicitly loaded fonts are used in both engines.
const base={text:'Привет мир',fontFamily:'SpikeSans',fontSize:20,w:260,h:240,lineHeight:1.15,textRuns:[{start:0,end:6,style:{textColor:'#ff0000'}}]};
const cases=[
 ['plain',{}],
 ...[1,3,5].map(n=>['spaces-'+n,{text:'alpha'+' '.repeat(n)+'beta gamma',w:75}]),
 ['leading',{text:'     alpha beta',w:75}],
 ['trailing',{text:'alpha beta     ',w:75}],
 ['before-LF',{text:'alpha     \nbeta   \n',w:75}],
 ['after-wrap',{text:'alpha beta     gamma delta',w:75}],
 ['long-word',{text:'abcdefghijklmnopqrstuvwxyz',w:75}],
 ['style-word',{text:'alphaSUPERLONGWORDomega beta',w:120,textRuns:[{start:7,end:15,style:{fontSize:32}}]}],
 ['mixed-size',{text:'AABBCC',w:65,textRuns:[{start:2,end:4,style:{fontSize:40}}]}],
 ['mixed-family',{text:'alpha beta gamma delta',w:150,textRuns:[{start:3,end:14,style:{fontFamily:'SpikeSerif',fontSize:32}}]}],
 ['bold',{text:'alpha beta gamma delta',w:100,textRuns:[{start:3,end:14,style:{fontWeight:700}}]}],
 ['spacing',{text:'alpha   beta gamma',w:90,letterSpacing:1.5}],
 ['unicode',{text:'A😀👩‍💻Б é кириллица',w:130,textRuns:[{start:1,end:8,style:{fontSize:32}}]}],
 ['blank-lines',{text:'A\n\nБ\n',w:100,textRuns:[{start:3,end:4,style:{fontSize:40}}]}],
 ['line-height-1.5',{text:'alpha     beta gamma',w:75,lineHeight:1.5}],
 ['mixed-height-1.5',{text:'AABBCC',w:65,lineHeight:1.5,textRuns:[{start:2,end:4,style:{fontSize:40}}]}],
 ['empty',{text:'',textRuns:[]}],
 ['only-LF',{text:'\n\n',textRuns:[]}],
 ['CRLF',{text:'alpha\r\n\r\nbeta\r\n',w:75}],
 ['lone-CR',{text:'alpha\rbeta',w:75}],
 ...['center','right'].map(textAlign=>[textAlign,{text:'alpha     beta gamma',w:75,textAlign}]),
];
module.exports={base,cases:cases.map(([name,value])=>[name,{...base,...value}])};
