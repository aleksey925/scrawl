const scrawlKeptShapes = ["<path", "<g ", "<g>", "</g>", "<circle ", "<ellipse ", "<text "];

nspsp_SvgNanoParser_getData = ($this) => {
  if (ju_AbstractCollection_isEmpty($this.$data24)) {
    nspsp_SvgNanoParser_$callClinit();
    const shapes = new RegExp($rt_ustr(jur_Pattern_pattern(nspsp_SvgNanoParser_P_TEXT_OR_DRAW)), "g");
    for (const [element] of $rt_ustr($this.$svg2).matchAll(shapes)) {
      if (scrawlKeptShapes.some((prefix) => element.startsWith(prefix))) {
        ju_ArrayList_add($this.$data24, $rt_str(element));
      }
    }
  }
  return $this.$data24;
};
