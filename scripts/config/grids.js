const imagesBaseUrl = new URL("../../assets/images/", import.meta.url);

export const MARKER_GRID = {
  imageSrc: new URL("skills_tab.png", imagesBaseUrl).href,
  imageAlt: "Skill tab image with click targets",
  stageMaxWidth: 408,
  grid: {
    columns: 3,
    rows: 8,
    cellWidth: 60,
    cellHeight: 29,
    columnGap: 3,
    rowGap: 1,
  },
  defaultPlacement: {
    x: 7.2,
    y: 9.2,
    scaleX: 1,
    scaleY: 0.999,
  },
};

export const NOTES_GRID = {
  imageSrc: new URL("skills_box.png", imagesBaseUrl).href,
  imageAlt: "Skill box image with click targets",
  stageMaxWidth: 720,
  grid: {
    columns: 6,
    rows: 4,
    cellWidth: 60,
    cellHeight: 29,
    columnGap: 3,
    rowGap: 1,
  },
  defaultPlacement: {
    x: 10.1,
    y: 9.1,
    scaleX: 1,
    scaleY: 1.002,
  },
};